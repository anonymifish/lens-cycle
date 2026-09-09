//! File-backed tests must retain evidence in an explicitly selected isolated run.
use std::path::{Path, PathBuf};

pub fn test_directory(name: &str) -> PathBuf {
    let configured = std::env::var_os("LENS_CYCLE_DATA_DIR")
        .expect("Set LENS_CYCLE_DATA_DIR to a new artifacts/runs/<run-id>/data directory");
    let root = PathBuf::from(configured)
        .canonicalize()
        .expect("Create the isolated run directory before running tests");
    let allowed = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("artifacts/runs")
        .canonicalize()
        .expect("Missing isolated runs directory");
    assert!(
        root.starts_with(&allowed) && root != allowed,
        "Unsafe test data root"
    );
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let target = root.join(format!("{name}-{}-{unique}", std::process::id()));
    std::fs::create_dir(&target).expect("Test directory must be new");
    crate::normalize_windows_path(target)
}
