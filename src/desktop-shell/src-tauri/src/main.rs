use std::ffi::{OsStr, OsString};

fn is_mcp_stdio_invocation(args: impl IntoIterator<Item = OsString>) -> bool {
    let mut args = args.into_iter();
    args.next().as_deref() == Some(OsStr::new("--mcp-stdio")) && args.next().is_none()
}

#[cfg(not(test))]
fn main() {
    if is_mcp_stdio_invocation(std::env::args_os().skip(1)) {
        std::process::exit(scadmill_desktop::run_mcp_stdio_client());
    }

    scadmill_desktop::run();
}

#[cfg(test)]
mod tests {
    use super::is_mcp_stdio_invocation;
    use std::ffi::OsString;

    #[test]
    fn recognizes_only_the_sole_exact_mcp_stdio_flag() {
        assert!(is_mcp_stdio_invocation([OsString::from("--mcp-stdio")]));
        assert!(!is_mcp_stdio_invocation([]));
        assert!(!is_mcp_stdio_invocation([OsString::from("--MCP-STDIO")]));
        assert!(!is_mcp_stdio_invocation([
            OsString::from("--mcp-stdio"),
            OsString::from("project.scad"),
        ]));
    }
}
