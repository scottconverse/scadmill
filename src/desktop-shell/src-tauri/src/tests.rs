use super::{
    NativeJobs, NativeProjectFile, NativeRenderFailureResponse, NativeRenderResponse,
    decode_project_files, finish_after_join, map_render_error,
};
use scadmill_native_engine::EngineError;
use std::sync::atomic::Ordering;

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
