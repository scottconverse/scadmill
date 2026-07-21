use std::ffi::{OsStr, OsString};

fn is_mcp_stdio_invocation(args: impl IntoIterator<Item = OsString>) -> bool {
    let mut args = args.into_iter();
    args.next().as_deref() == Some(OsStr::new("--mcp-stdio")) && args.next().is_none()
}

fn is_headless_invocation(args: impl IntoIterator<Item = OsString>) -> bool {
    args.into_iter().next().is_some_and(|command| {
        matches!(
            command.to_str(),
            Some(
                "render"
                    | "export"
                    | "params"
                    | "check"
                    | "help"
                    | "version"
                    | "--help"
                    | "-h"
                    | "--version"
                    | "-V"
            )
        )
    })
}

#[cfg(not(test))]
fn main() {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if is_mcp_stdio_invocation(arguments.clone()) {
        std::process::exit(scadmill_desktop::run_mcp_stdio_client());
    }
    if is_headless_invocation(arguments.clone()) {
        std::process::exit(scadmill_desktop::run_headless_cli(arguments));
    }

    scadmill_desktop::run();
}

#[cfg(test)]
mod tests {
    use super::{is_headless_invocation, is_mcp_stdio_invocation};
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

    #[test]
    fn recognizes_only_named_headless_commands() {
        assert!(is_headless_invocation([
            OsString::from("export"),
            OsString::from("part.scad")
        ]));
        assert!(is_headless_invocation([
            OsString::from("params"),
            OsString::from("part.scad")
        ]));
        assert!(!is_headless_invocation([
            OsString::from("unknown"),
            OsString::from("part.scad")
        ]));
        assert!(!is_headless_invocation([]));
    }
}
