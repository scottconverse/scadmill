use super::{
    NativeJobs, NativeProjectFile, NativeRenderFailureResponse, NativeRenderResponse,
    decode_project_files, finish_after_join, map_render_error,
};
use scadmill_native_engine::EngineError;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct MemoryKeychain(Mutex<Option<String>>);

impl super::keychain::SecretBackend for MemoryKeychain {
    fn load(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().expect("keychain lock").clone())
    }

    fn save(&self, secret: &str) -> Result<(), String> {
        *self.0.lock().expect("keychain lock") = Some(secret.to_string());
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        *self.0.lock().expect("keychain lock") = None;
        Ok(())
    }
}

fn privacy_test_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "scadmill-secret-scan-{}-{nonce}",
        std::process::id()
    ))
}

fn regular_files(root: &Path) -> Vec<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).expect("read app-managed directory") {
            let path = entry.expect("read app-managed entry").path();
            if path.is_dir() {
                pending.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}

#[test]
fn maps_an_engine_process_error_to_the_typed_failure_wire_shape() {
    let mapped = map_render_error(EngineError::Process {
        exit_code: Some(1),
        log: "ERROR: Parser error in file main.scad, line 2".to_string(),
    });
    assert_eq!(
        mapped,
        Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
            kind: "failure",
            reason: "engine-error",
            exit_code: Some(1),
            raw_log: "ERROR: Parser error in file main.scad, line 2".to_string(),
        },))
    );
}

#[test]
fn maps_a_missing_engine_to_the_normative_failure_reason() {
    assert_eq!(
        map_render_error(EngineError::Missing),
        Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
            kind: "failure",
            reason: "engine-missing",
            exit_code: None,
            raw_log: "OpenSCAD engine was not found".to_string(),
        },))
    );
}

#[test]
fn maps_an_artifact_failure_without_discarding_the_engine_log() {
    assert_eq!(
        map_render_error(EngineError::Artifact {
            operation: "parse the rendered STL",
            detail: "malformed binary STL".to_string(),
            log: "SENTINEL COMPLETE ENGINE LOG".to_string(),
        }),
        Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
            kind: "failure",
            reason: "engine-error",
            exit_code: None,
            raw_log: "SENTINEL COMPLETE ENGINE LOG".to_string(),
        }))
    );
}

#[test]
fn decodes_text_and_binary_project_files_without_coercion() {
    let files = decode_project_files(
        "models/main.scad",
        vec![
            NativeProjectFile {
                path: "models/main.scad".to_string(),
                text: true,
                contents_base64: "Y3ViZSgxMCk7".to_string(),
            },
            NativeProjectFile {
                path: "assets/reference.stl".to_string(),
                text: false,
                contents_base64: "AP8B".to_string(),
            },
        ],
    )
    .expect("project wire files should decode");
    assert_eq!(files["models/main.scad"], b"cube(10);");
    assert_eq!(files["assets/reference.stl"], [0, 255, 1]);
}

#[test]
fn cancellation_is_idempotent_and_targets_only_a_registered_job() {
    let jobs = NativeJobs::default();
    jobs.cancel("unknown");
    let token = jobs.register("job-1").expect("register job");
    assert!(!token.load(Ordering::Acquire));
    jobs.cancel("job-1");
    jobs.cancel("job-1");
    assert!(token.load(Ordering::Acquire));
    jobs.finish("job-1", &token);
    jobs.cancel("job-1");
}

#[test]
fn cancellation_that_arrives_before_registration_is_consumed_by_that_job() {
    let jobs = NativeJobs::default();
    jobs.cancel("job-1");

    let cancelled = jobs.register("job-1").expect("register cancelled job");
    assert!(cancelled.load(Ordering::Acquire));
    jobs.finish("job-1", &cancelled);

    let later = jobs.register("job-1").expect("register later job");
    assert!(!later.load(Ordering::Acquire));
}

#[test]
fn pending_cancellation_tombstones_are_bounded() {
    let jobs = NativeJobs::default();
    for index in 0..300 {
        jobs.cancel(&format!("job-{index}"));
    }

    let evicted = jobs.register("job-0").expect("register evicted id");
    let retained = jobs.register("job-299").expect("register retained id");
    assert!(!evicted.load(Ordering::Acquire));
    assert!(retained.load(Ordering::Acquire));
}

#[test]
fn join_failure_does_not_leave_the_job_registered() {
    let jobs = NativeJobs::default();
    let token = jobs.register("job-1").expect("register job");

    let result = finish_after_join::<()>(&jobs, "job-1", &token, Err("join failed".into()));

    assert_eq!(result, Err("join failed".to_string()));
    jobs.cancel("job-1");
    assert!(!token.load(Ordering::Acquire));
}

#[test]
fn completing_a_superseded_job_keeps_the_replacement_registered() {
    let jobs = NativeJobs::default();
    let superseded = jobs.register("job-1").expect("register first job");
    let replacement = jobs.register("job-1").expect("register replacement job");
    assert!(superseded.load(Ordering::Acquire));

    let result = finish_after_join(&jobs, "job-1", &superseded, Ok("finished"));

    assert_eq!(result, Ok("finished"));
    jobs.cancel("job-1");
    assert!(replacement.load(Ordering::Acquire));
}

#[test]
fn ai_secret_is_absent_from_every_app_managed_file_after_representative_writes() {
    const SENTINEL: &str = "M2-AC9C-SENTINEL-DO-NOT-PERSIST";
    let root = privacy_test_root();
    let settings = root.join("config/settings-v1.json");
    let project = root.join("project");
    let downloads = root.join("downloads");
    let keychain = MemoryKeychain::default();

    super::desktop_settings::save_settings_file(
        &settings,
        r#"{"version":1,"ai":{"provider":"openai","persistWebSecret":false}}"#,
    )
    .expect("save settings");
    fs::create_dir_all(&project).expect("create project root");
    super::project_storage::write_project_file(&project, "main.scad", b"cube(10);")
        .expect("save project file");
    super::artifact_storage::save_artifact_in(&downloads, "cube.stl", b"mesh bytes")
        .expect("save artifact");
    super::keychain::save_secret(&keychain, SENTINEL).expect("save keychain secret");

    let files = regular_files(&root);
    assert_eq!(files.len(), 3, "scan the complete app-managed fixture tree");
    for path in files {
        let bytes = fs::read(&path).expect("scan app-managed file");
        assert!(
            !bytes
                .windows(SENTINEL.len())
                .any(|window| window == SENTINEL.as_bytes()),
            "secret leaked into {}",
            path.display()
        );
    }
    assert_eq!(
        super::keychain::load_secret(&keychain).expect("load keychain secret"),
        SENTINEL
    );
    fs::remove_dir_all(root).expect("cleanup privacy fixture");
}
