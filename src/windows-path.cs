using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

class KimiSwarmPath {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam,
        string lParam, uint flags, uint timeout, out UIntPtr result);

    static string RawPath(RegistryKey key) {
        object value = key == null ? null : key.GetValue("Path", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        if (value != null && !(value is string)) throw new InvalidOperationException("PATH is not a string.");
        return (string)value;
    }

    static int Main(string[] args) {
        try {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            var json = new JavaScriptSerializer();
            using (var user = Registry.CurrentUser.OpenSubKey("Environment", args.Length == 1 && args[0] == "write"))
            using (var machine = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")) {
                if (user == null) throw new InvalidOperationException("User environment registry key is unavailable.");
                string previous = RawPath(user);
                string kind = previous == null ? "ExpandString" : user.GetValueKind("Path").ToString();
                if (kind != "String" && kind != "ExpandString") throw new InvalidOperationException("Unsupported PATH registry type.");
                if (args.Length == 1 && args[0] == "read") {
                    Console.WriteLine(json.Serialize(new { userPath = previous, machinePath = RawPath(machine), kind = kind }));
                    return 0;
                }
                if (args.Length != 1 || args[0] != "write") throw new ArgumentException("Use read or write.");
                var input = json.Deserialize<Dictionary<string, object>>(Console.In.ReadToEnd());
                if (!input.ContainsKey("expected") || !Object.Equals(previous, input["expected"]))
                    throw new InvalidOperationException("User PATH changed; retry without overwriting concurrent changes.");
                string next = input["value"] as string;
                if (next == null) throw new ArgumentException("Expected a PATH string.");
                user.SetValue("Path", next, kind == "String" ? RegistryValueKind.String : RegistryValueKind.ExpandString);
                UIntPtr result;
                SendMessageTimeout(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment", 2, 500, out result);
                Console.WriteLine("Updated current-user PATH.");
                return 0;
            }
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
