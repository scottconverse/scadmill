param(
  [Parameter(Mandatory = $true)] [int] $ProcessId,
  [Parameter(Mandatory = $true)] [string] $TextBase64
)

$ErrorActionPreference = "Stop"
if ($ProcessId -le 0) { throw "ProcessId must be positive." }

$bytes = [Convert]::FromBase64String($TextBase64)
if ($bytes.Length -eq 0 -or $bytes.Length -gt 8192) { throw "Text payload size is invalid." }
$text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)

if (-not ("ScadMill.WindowsInput" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace ScadMill {
  public static class WindowsInput {
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_A = 0x41;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT {
      public int dx;
      public int dy;
      public uint mouseData;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT {
      public uint uMsg;
      public ushort wParamL;
      public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT {
      public uint type;
      public INPUTUNION data;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private static INPUT VirtualKey(ushort key, bool keyUp) {
      return new INPUT {
        type = INPUT_KEYBOARD,
        data = new INPUTUNION {
          ki = new KEYBDINPUT { wVk = key, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0 }
        }
      };
    }

    private static INPUT Unicode(char character, bool keyUp) {
      return new INPUT {
        type = INPUT_KEYBOARD,
        data = new INPUTUNION {
          ki = new KEYBDINPUT {
            wScan = character,
            dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0)
          }
        }
      };
    }

    public static int ReplaceFocusedText(int processId, string text) {
      using (Process process = Process.GetProcessById(processId)) {
        process.Refresh();
        IntPtr window = process.MainWindowHandle;
        if (window == IntPtr.Zero) throw new InvalidOperationException("Target process has no main window.");
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owner != (uint)processId) throw new InvalidOperationException("Main window process identity changed.");
        ShowWindow(window, SW_RESTORE);
        if (!SetForegroundWindow(window) && GetForegroundWindow() != window) {
          throw new InvalidOperationException("Target window could not be activated.");
        }
        Thread.Sleep(100);

        var inputs = new List<INPUT>(4 + text.Length * 2) {
          VirtualKey(VK_CONTROL, false),
          VirtualKey(VK_A, false),
          VirtualKey(VK_A, true),
          VirtualKey(VK_CONTROL, true)
        };
        foreach (char character in text) {
          inputs.Add(Unicode(character, false));
          inputs.Add(Unicode(character, true));
        }
        INPUT[] payload = inputs.ToArray();
        uint sent = SendInput((uint)payload.Length, payload, Marshal.SizeOf(typeof(INPUT)));
        if (sent != payload.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
        Thread.Sleep(50);
        return payload.Length;
      }
    }
  }
}
"@
}

$sent = [ScadMill.WindowsInput]::ReplaceFocusedText($ProcessId, $text)
[ordered]@{ activated = $true; sent = $sent } | ConvertTo-Json -Compress
