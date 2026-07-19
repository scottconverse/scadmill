use base64::Engine as _;
use reqwest::{
    Client, Url,
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tauri::{AppHandle, ipc::Channel};
use tokio::sync::Notify;

use crate::desktop_settings::{load_settings_file, settings_path};

const REQUEST_SIZE_LIMIT: usize = 8 * 1024 * 1024;
const RESPONSE_SIZE_LIMIT: usize = 32 * 1024 * 1024;
const RESPONSE_CHUNK_LIMIT: usize = 64 * 1024;
const RESPONSE_HEADER_COUNT_LIMIT: usize = 64;
const RESPONSE_HEADER_BYTES_LIMIT: usize = 64 * 1024;
const PENDING_CANCEL_LIMIT: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiHttpRequest {
    request_id: String,
    configuration_id: Option<String>,
    endpoint: String,
    method: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum AiHttpEvent {
    Start {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk {
        bytes_base64: String,
    },
    End,
}

#[derive(Debug)]
struct Cancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl Cancellation {
    fn new(cancelled: bool) -> Self {
        Self {
            cancelled: AtomicBool::new(cancelled),
            notify: Notify::new(),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    async fn wait(&self) {
        loop {
            let notified = self.notify.notified();
            if self.cancelled.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, Arc<Cancellation>>,
    pending: VecDeque<String>,
}

pub(crate) struct AiHttpBroker {
    client: Client,
    requests: Mutex<RequestRegistry>,
}

impl AiHttpBroker {
    fn new() -> Result<Self, String> {
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| format!("Could not initialize AI HTTP transport: {error}"))?;
        Ok(Self {
            client,
            requests: Mutex::default(),
        })
    }

    fn register(&self, request_id: &str) -> Result<Arc<Cancellation>, String> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err("AI HTTP request id is invalid.".to_string());
        }
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "AI HTTP request registry failed.")?;
        let was_cancelled = requests
            .pending
            .iter()
            .position(|id| id == request_id)
            .and_then(|index| requests.pending.remove(index))
            .is_some();
        let token = Arc::new(Cancellation::new(was_cancelled));
        if let Some(previous) = requests
            .active
            .insert(request_id.to_string(), Arc::clone(&token))
        {
            previous.cancel();
        }
        Ok(token)
    }

    fn cancel(&self, request_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            if let Some(token) = requests.active.get(request_id) {
                token.cancel();
            } else if !requests.pending.iter().any(|id| id == request_id) {
                requests.pending.push_back(request_id.to_string());
                while requests.pending.len() > PENDING_CANCEL_LIMIT {
                    requests.pending.pop_front();
                }
            }
        }
    }

    fn finish(&self, request_id: &str, token: &Arc<Cancellation>) {
        if let Ok(mut requests) = self.requests.lock()
            && requests
                .active
                .get(request_id)
                .is_some_and(|current| Arc::ptr_eq(current, token))
        {
            requests.active.remove(request_id);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Provider {
    OpenAi,
    Anthropic,
    Compatible,
    Local,
}

fn provider(value: &str) -> Result<Provider, String> {
    match value {
        "openai" => Ok(Provider::OpenAi),
        "anthropic" => Ok(Provider::Anthropic),
        "compatible" => Ok(Provider::Compatible),
        "local" => Ok(Provider::Local),
        _ => Err("The selected AI provider is not configured.".to_string()),
    }
}

fn normalize_endpoint(provider: Provider, endpoint: &str) -> Result<Url, String> {
    let fallback = match provider {
        Provider::OpenAi => "https://api.openai.com/v1/chat/completions",
        Provider::Anthropic => "https://api.anthropic.com/v1/messages",
        Provider::Compatible | Provider::Local => "http://localhost:11434/api/chat",
    };
    let url = Url::parse(if endpoint.trim().is_empty() {
        fallback
    } else {
        endpoint.trim()
    })
    .map_err(|_| "AI endpoint is invalid.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("AI endpoint must use HTTP or HTTPS.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("AI endpoint must not contain credentials or a fragment.".to_string());
    }
    Ok(url)
}

fn exact_object_keys(object: &serde_json::Map<String, Value>, expected: &[&str]) -> bool {
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}

fn valid_profile_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value != "default"
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn validate_persisted_ai(root: &Value) -> Result<&serde_json::Map<String, Value>, String> {
    let root_object = root
        .as_object()
        .ok_or_else(|| "Persisted settings do not match the exact version-1 schema.".to_string())?;
    if !exact_object_keys(
        root_object,
        &[
            "version",
            "editor",
            "rendering",
            "engine",
            "viewer",
            "formatter",
            "theme",
            "ai",
            "keybindings",
            "privacy",
        ],
    ) || [
        "editor",
        "rendering",
        "engine",
        "viewer",
        "formatter",
        "theme",
        "keybindings",
        "privacy",
    ]
    .iter()
    .any(|key| !root_object.get(*key).is_some_and(Value::is_object))
    {
        return Err("Persisted settings do not match the exact version-1 schema.".to_string());
    }
    if root.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Persisted AI settings do not use the supported version.".to_string());
    }
    let ai = root
        .get("ai")
        .and_then(Value::as_object)
        .ok_or_else(|| "Persisted AI settings are missing.".to_string())?;
    if !exact_object_keys(
        ai,
        &[
            "provider",
            "endpoint",
            "model",
            "models",
            "configurations",
            "persistWebSecret",
        ],
    ) {
        return Err("Persisted AI settings do not match the exact version-1 schema.".to_string());
    }
    let provider = ai.get("provider").and_then(Value::as_str).unwrap_or("");
    let endpoint = ai.get("endpoint").and_then(Value::as_str).unwrap_or("");
    let model = ai.get("model").and_then(Value::as_str).unwrap_or("");
    let models = ai.get("models").and_then(Value::as_array).ok_or_else(|| {
        "Persisted AI settings do not match the exact version-1 schema.".to_string()
    })?;
    let configurations = ai
        .get("configurations")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "Persisted AI settings do not match the exact version-1 schema.".to_string()
        })?;
    if !matches!(
        provider,
        "none" | "openai" | "anthropic" | "compatible" | "local"
    ) || endpoint.len() > 2_048
        || model.len() > 512
        || models.len() > 32
        || configurations.len() > 16
        || ai
            .get("persistWebSecret")
            .and_then(Value::as_bool)
            .is_none()
    {
        return Err("Persisted AI settings do not match the exact version-1 schema.".to_string());
    }
    let mut seen_models = HashSet::new();
    for candidate in models {
        let candidate = candidate.as_str().ok_or_else(|| {
            "Persisted AI settings do not match the exact version-1 schema.".to_string()
        })?;
        if candidate.is_empty()
            || candidate.len() > 512
            || candidate.trim() != candidate
            || !seen_models.insert(candidate)
        {
            return Err(
                "Persisted AI settings do not match the exact version-1 schema.".to_string(),
            );
        }
    }
    let mut seen_ids = HashSet::new();
    for candidate in configurations {
        let candidate = candidate.as_object().ok_or_else(|| {
            "Persisted AI settings do not match the exact version-1 schema.".to_string()
        })?;
        if !exact_object_keys(candidate, &["id", "label", "provider", "endpoint", "model"]) {
            return Err(
                "Persisted AI settings do not match the exact version-1 schema.".to_string(),
            );
        }
        let id = candidate.get("id").and_then(Value::as_str).unwrap_or("");
        let label = candidate.get("label").and_then(Value::as_str).unwrap_or("");
        let provider = candidate
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("");
        let endpoint = candidate
            .get("endpoint")
            .and_then(Value::as_str)
            .unwrap_or("");
        let model = candidate.get("model").and_then(Value::as_str).unwrap_or("");
        if !valid_profile_id(id)
            || !seen_ids.insert(id)
            || label.is_empty()
            || label.len() > 128
            || label.trim() != label
            || !matches!(provider, "openai" | "anthropic" | "compatible" | "local")
            || endpoint.len() > 2_048
            || model.is_empty()
            || model.len() > 512
            || model.trim() != model
        {
            return Err(
                "Persisted AI settings do not match the exact version-1 schema.".to_string(),
            );
        }
    }
    Ok(ai)
}

fn persisted_configuration(
    serialized: &str,
    configuration_id: Option<&str>,
) -> Result<(Provider, String), String> {
    let root: Value = serde_json::from_str(serialized)
        .map_err(|_| "Persisted AI settings are invalid.".to_string())?;
    let ai = validate_persisted_ai(&root)?;
    if let Some(id) = configuration_id {
        let configurations = ai
            .get("configurations")
            .and_then(Value::as_array)
            .ok_or_else(|| "Persisted AI profiles are invalid.".to_string())?;
        let selected = configurations
            .iter()
            .find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| "The selected AI configuration is not persisted.".to_string())?;
        let selected_provider = provider(
            selected
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )?;
        let endpoint = selected
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or_else(|| "The selected AI endpoint is invalid.".to_string())?;
        return Ok((selected_provider, endpoint.to_string()));
    }
    let selected_provider = provider(ai.get("provider").and_then(Value::as_str).unwrap_or(""))?;
    let endpoint = ai
        .get("endpoint")
        .and_then(Value::as_str)
        .ok_or_else(|| "The selected AI endpoint is invalid.".to_string())?;
    Ok((selected_provider, endpoint.to_string()))
}

fn authorize_request(
    serialized: &str,
    request: &AiHttpRequest,
) -> Result<(Url, HeaderMap), String> {
    if request.method != "POST" {
        return Err("Desktop AI HTTP requests must use POST.".to_string());
    }
    if request.body.len() > REQUEST_SIZE_LIMIT {
        return Err("Desktop AI HTTP request exceeds the supported size.".to_string());
    }
    serde_json::from_str::<Value>(&request.body)
        .map_err(|_| "Desktop AI HTTP request body must be valid JSON.".to_string())?;
    let (selected_provider, configured) =
        persisted_configuration(serialized, request.configuration_id.as_deref())?;
    let configured = normalize_endpoint(selected_provider, &configured)?;
    let requested = normalize_endpoint(selected_provider, &request.endpoint)?;
    if configured != requested {
        return Err("AI endpoint does not match the selected persisted configuration.".to_string());
    }

    let mut headers = HeaderMap::new();
    let mut seen = HashSet::new();
    for (name, value) in &request.headers {
        let normalized = name.to_ascii_lowercase();
        if !seen.insert(normalized.clone()) {
            return Err("AI HTTP request contains a duplicate header.".to_string());
        }
        let allowed = normalized == "content-type"
            || match selected_provider {
                Provider::Anthropic => {
                    matches!(normalized.as_str(), "x-api-key" | "anthropic-version")
                }
                Provider::OpenAi | Provider::Compatible | Provider::Local => {
                    normalized == "authorization"
                }
            };
        if !allowed {
            return Err(format!("AI HTTP header is not permitted: {normalized}"));
        }
        if normalized == "content-type" && value != "application/json" {
            return Err("Desktop AI HTTP content type must be application/json.".to_string());
        }
        if value.is_empty() || value.len() > 16 * 1024 {
            return Err("AI HTTP header value is invalid.".to_string());
        }
        let name = HeaderName::from_bytes(normalized.as_bytes())
            .map_err(|_| "AI HTTP header name is invalid.".to_string())?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| "AI HTTP header value is invalid.".to_string())?;
        headers.insert(name, value);
    }
    if headers.get("content-type").is_none() {
        return Err("Desktop AI HTTP content type is required.".to_string());
    }
    Ok((requested, headers))
}

fn response_headers(headers: &HeaderMap) -> Result<Vec<(String, String)>, String> {
    if headers.len() > RESPONSE_HEADER_COUNT_LIMIT {
        return Err("AI HTTP response has too many headers.".to_string());
    }
    let mut output = Vec::with_capacity(headers.len());
    let mut total = 0_usize;
    for (name, value) in headers {
        let value = value
            .to_str()
            .map_err(|_| "AI HTTP response contains a non-text header.".to_string())?;
        total = total
            .saturating_add(name.as_str().len())
            .saturating_add(value.len());
        if total > RESPONSE_HEADER_BYTES_LIMIT {
            return Err("AI HTTP response headers exceed the supported size.".to_string());
        }
        output.push((name.to_string(), value.to_string()));
    }
    Ok(output)
}

fn checked_response_total(current: usize, additional: usize) -> Result<usize, String> {
    let total = current
        .checked_add(additional)
        .ok_or_else(|| "AI HTTP response exceeds the supported size.".to_string())?;
    if total > RESPONSE_SIZE_LIMIT {
        return Err("AI HTTP response exceeds the supported size.".to_string());
    }
    Ok(total)
}

async fn execute_request(
    client: &Client,
    url: Url,
    headers: HeaderMap,
    body: String,
    cancellation: &Cancellation,
    mut emit: impl FnMut(AiHttpEvent) -> Result<(), String>,
) -> Result<(), String> {
    let response = tokio::select! {
        result = client.post(url).headers(headers).body(body).send() => result.map_err(|error| format!("AI HTTP request failed: {error}"))?,
        () = cancellation.wait() => return Err("AI HTTP request was cancelled.".to_string()),
    };
    if response
        .content_length()
        .is_some_and(|size| size > RESPONSE_SIZE_LIMIT as u64)
    {
        return Err("AI HTTP response exceeds the supported size.".to_string());
    }
    let status = response.status().as_u16();
    let headers = response_headers(response.headers())?;
    emit(AiHttpEvent::Start { status, headers })?;
    let mut response = response;
    let mut total = 0_usize;
    loop {
        let chunk = tokio::select! {
            result = response.chunk() => result.map_err(|error| format!("AI HTTP response failed: {error}"))?,
            () = cancellation.wait() => return Err("AI HTTP request was cancelled.".to_string()),
        };
        let Some(chunk) = chunk else { break };
        total = checked_response_total(total, chunk.len())?;
        for part in chunk.chunks(RESPONSE_CHUNK_LIMIT) {
            emit(AiHttpEvent::Chunk {
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(part),
            })?;
        }
    }
    emit(AiHttpEvent::End)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn ai_http_request(
    app: AppHandle,
    broker: tauri::State<'_, AiHttpBroker>,
    request: AiHttpRequest,
    on_event: Channel<AiHttpEvent>,
) -> Result<(), String> {
    let serialized = load_settings_file(&settings_path(&app)?)?
        .ok_or_else(|| "AI settings are not persisted.".to_string())?;
    let (url, headers) = authorize_request(&serialized, &request)?;
    let token = broker.register(&request.request_id)?;
    let result = execute_request(
        &broker.client,
        url,
        headers,
        request.body,
        &token,
        |event| {
            on_event
                .send(event)
                .map_err(|error| format!("Could not stream AI HTTP response: {error}"))
        },
    )
    .await;
    broker.finish(&request.request_id, &token);
    result
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn cancel_ai_http_request(broker: tauri::State<'_, AiHttpBroker>, request_id: String) {
    broker.cancel(&request_id);
}

pub(crate) fn create_broker() -> Result<AiHttpBroker, String> {
    AiHttpBroker::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    fn settings(endpoint: &str) -> String {
        serde_json::json!({ "version": 1,
          "editor": {}, "rendering": {}, "engine": {}, "viewer": {}, "formatter": {}, "theme": {}, "keybindings": {}, "privacy": {},
          "ai": {
            "provider": "openai", "endpoint": endpoint, "model": "primary", "models": ["primary"], "persistWebSecret": false,
            "configurations": [{ "id": "reviewer", "label": "Review", "provider": "compatible", "endpoint": endpoint, "model": "review-model" }]
        } }).to_string()
    }

    fn request(endpoint: String) -> AiHttpRequest {
        AiHttpRequest {
            request_id: "request-1".into(),
            configuration_id: None,
            endpoint,
            method: "POST".into(),
            headers: vec![
                ("content-type".into(), "application/json".into()),
                ("authorization".into(), "Bearer secret".into()),
            ],
            body: "{}".into(),
        }
    }

    fn serve_once(response: Vec<u8>) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer);
            stream.write_all(&response).expect("respond");
        });
        (format!("http://{address}/v1/chat/completions"), handle)
    }

    #[test]
    fn rejects_an_endpoint_not_bound_to_the_persisted_configuration() {
        let request = request("https://other.example/v1/chat/completions".into());
        let error = authorize_request(
            &settings("https://configured.example/v1/chat/completions"),
            &request,
        )
        .expect_err("mismatch must fail");
        assert_eq!(
            error,
            "AI endpoint does not match the selected persisted configuration."
        );
    }

    #[test]
    fn accepts_only_post_json_and_provider_specific_headers() {
        let endpoint = "https://configured.example/v1/chat/completions";
        let mut candidate = request(endpoint.into());
        candidate.method = "GET".into();
        assert!(
            authorize_request(&settings(endpoint), &candidate)
                .unwrap_err()
                .contains("POST")
        );
        candidate.method = "POST".into();
        candidate.headers.push(("cookie".into(), "unsafe".into()));
        assert!(
            authorize_request(&settings(endpoint), &candidate)
                .unwrap_err()
                .contains("not permitted")
        );
    }

    #[test]
    fn authorizes_the_exact_persisted_profile() {
        let endpoint = "https://configured.example/v1/chat/completions";
        let mut candidate = request(endpoint.into());
        candidate.configuration_id = Some("reviewer".into());
        assert!(authorize_request(&settings(endpoint), &candidate).is_ok());
        candidate.configuration_id = Some("missing".into());
        assert!(
            authorize_request(&settings(endpoint), &candidate)
                .unwrap_err()
                .contains("not persisted")
        );
    }

    #[test]
    fn rejects_tampered_or_partial_persisted_ai_settings() {
        let endpoint = "https://configured.example/v1/chat/completions";
        let candidate = request(endpoint.into());
        let minimal = serde_json::json!({ "version": 1, "ai": serde_json::from_str::<Value>(&settings(endpoint)).unwrap()["ai"] }).to_string();
        assert!(
            authorize_request(&minimal, &candidate)
                .unwrap_err()
                .contains("exact version-1 schema")
        );
        let partial = serde_json::json!({ "version": 1,
          "editor": {}, "rendering": {}, "engine": {}, "viewer": {}, "formatter": {}, "theme": {}, "keybindings": {}, "privacy": {},
          "ai": { "provider": "openai", "endpoint": endpoint, "configurations": [] }
        }).to_string();
        assert!(
            authorize_request(&partial, &candidate)
                .unwrap_err()
                .contains("exact version-1 schema")
        );
        let mut tampered: Value = serde_json::from_str(&settings(endpoint)).unwrap();
        tampered["ai"]["configurations"][0]["extra"] = Value::Bool(true);
        assert!(
            authorize_request(&tampered.to_string(), &candidate)
                .unwrap_err()
                .contains("exact version-1 schema")
        );
    }

    #[test]
    fn rejects_cumulative_response_bytes_and_header_fanout_beyond_the_bounds() {
        assert_eq!(
            checked_response_total(RESPONSE_SIZE_LIMIT - 1, 1),
            Ok(RESPONSE_SIZE_LIMIT)
        );
        assert!(
            checked_response_total(RESPONSE_SIZE_LIMIT, 1)
                .unwrap_err()
                .contains("exceeds")
        );
        let mut headers = HeaderMap::new();
        for index in 0..=RESPONSE_HEADER_COUNT_LIMIT {
            headers.insert(
                HeaderName::from_bytes(format!("x-{index}").as_bytes()).unwrap(),
                HeaderValue::from_static("v"),
            );
        }
        assert!(response_headers(&headers).unwrap_err().contains("too many"));
    }

    #[tokio::test]
    async fn streams_error_status_headers_and_body() {
        let body = br#"{"error":"slow down"}"#;
        let response = format!("HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes().into_iter().chain(body.iter().copied()).collect();
        let (endpoint, server) = serve_once(response);
        let candidate = request(endpoint.clone());
        let (url, headers) =
            authorize_request(&settings(&endpoint), &candidate).expect("authorize");
        let events = Arc::new(Mutex::new(Vec::new()));
        let output = Arc::clone(&events);
        execute_request(
            &AiHttpBroker::new().unwrap().client,
            url,
            headers,
            candidate.body,
            &Cancellation::new(false),
            move |event| {
                output.lock().unwrap().push(event);
                Ok(())
            },
        )
        .await
        .expect("request");
        server.join().expect("server");
        let events = events.lock().unwrap();
        assert!(matches!(
            events.first(),
            Some(AiHttpEvent::Start { status: 429, .. })
        ));
        assert!(matches!(events.last(), Some(AiHttpEvent::End)));
        let bytes = events
            .iter()
            .filter_map(|event| {
                if let AiHttpEvent::Chunk { bytes_base64 } = event {
                    Some(
                        base64::engine::general_purpose::STANDARD
                            .decode(bytes_base64)
                            .unwrap(),
                    )
                } else {
                    None
                }
            })
            .flatten()
            .collect::<Vec<_>>();
        assert_eq!(bytes, body);
    }

    #[tokio::test]
    async fn does_not_follow_redirects() {
        let target_hits = Arc::new(AtomicUsize::new(0));
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        let target_address = target.local_addr().unwrap();
        target.set_nonblocking(true).unwrap();
        let hits = Arc::clone(&target_hits);
        let target_server = thread::spawn(move || {
            for _ in 0..50 {
                match target.accept() {
                    Ok((_stream, _)) => {
                        hits.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                    Err(_) => thread::sleep(Duration::from_millis(10)),
                }
            }
        });
        let redirect = format!("HTTP/1.1 302 Found\r\nLocation: http://{target_address}/target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes();
        let (endpoint, redirect_server) = serve_once(redirect);
        let candidate = request(endpoint.clone());
        let (url, headers) = authorize_request(&settings(&endpoint), &candidate).unwrap();
        let mut events = Vec::new();
        execute_request(
            &AiHttpBroker::new().unwrap().client,
            url,
            headers,
            candidate.body,
            &Cancellation::new(false),
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap();
        redirect_server.join().unwrap();
        target_server.join().unwrap();
        assert!(matches!(
            events.first(),
            Some(AiHttpEvent::Start { status: 302, .. })
        ));
        assert_eq!(target_hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn rejects_an_oversized_response_before_streaming() {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            RESPONSE_SIZE_LIMIT + 1
        )
        .into_bytes();
        let (endpoint, server) = serve_once(response);
        let candidate = request(endpoint.clone());
        let (url, headers) = authorize_request(&settings(&endpoint), &candidate).unwrap();
        let mut events = Vec::new();
        let error = execute_request(
            &AiHttpBroker::new().unwrap().client,
            url,
            headers,
            candidate.body,
            &Cancellation::new(false),
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("exceeds"));
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_secs(2));
        });
        let candidate = request(endpoint.clone());
        let (url, headers) = authorize_request(&settings(&endpoint), &candidate).unwrap();
        let cancellation = Arc::new(Cancellation::new(false));
        let cancel = Arc::clone(&cancellation);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancel.cancel();
        });
        let error = execute_request(
            &AiHttpBroker::new().unwrap().client,
            url,
            headers,
            candidate.body,
            &cancellation,
            |_| Ok(()),
        )
        .await
        .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("cancelled"));
    }
}
