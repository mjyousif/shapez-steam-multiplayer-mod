using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ShapezCoopInstaller
{
    public class InstallerLogic
    {
        public static string FindShapezDirectory()
        {
            var candidates = new List<string>();

            // 1. Direct Steam App Uninstall Registry Key (App ID 1318690 = shapez)
            string[] uninstallKeys = {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 1318690",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 1318690"
            };

            foreach (var keyPath in uninstallKeys)
            {
                try
                {
                    using (var key = Registry.LocalMachine.OpenSubKey(keyPath))
                    {
                        if (key != null)
                        {
                            var loc = key.GetValue("InstallLocation") as string;
                            if (!string.IsNullOrEmpty(loc) && IsValidShapezDir(loc))
                            {
                                return loc;
                            }
                        }
                    }
                }
                catch { }

                try
                {
                    using (var key = Registry.CurrentUser.OpenSubKey(keyPath))
                    {
                        if (key != null)
                        {
                            var loc = key.GetValue("InstallLocation") as string;
                            if (!string.IsNullOrEmpty(loc) && IsValidShapezDir(loc))
                            {
                                return loc;
                            }
                        }
                    }
                }
                catch { }
            }

            // 2. Steam Root Registry checks
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    if (key != null)
                    {
                        var val = key.GetValue("SteamPath") as string;
                        if (!string.IsNullOrEmpty(val))
                        {
                            candidates.AddRange(GetSteamLibraryCandidates(val.Replace('/', '\\')));
                        }
                    }
                }
            }
            catch { }

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam"))
                {
                    if (key != null)
                    {
                        var val = key.GetValue("InstallPath") as string;
                        if (!string.IsNullOrEmpty(val))
                        {
                            candidates.AddRange(GetSteamLibraryCandidates(val));
                        }
                    }
                }
            }
            catch { }

            // 2. Common drive fallbacks
            string[] defaultRoots = {
                @"C:\Program Files (x86)\Steam",
                @"C:\Program Files\Steam",
                @"D:\Steam",
                @"D:\SteamLibrary",
                @"E:\Steam",
                @"E:\SteamLibrary",
                @"F:\SteamLibrary"
            };

            foreach (var root in defaultRoots)
            {
                candidates.AddRange(GetSteamLibraryCandidates(root));
            }

            foreach (var cand in candidates)
            {
                if (IsValidShapezDir(cand))
                {
                    return cand;
                }
            }

            return @"C:\Program Files (x86)\Steam\steamapps\common\shapez.io";
        }

        private static List<string> GetSteamLibraryCandidates(string steamRoot)
        {
            var list = new List<string>();
            if (string.IsNullOrEmpty(steamRoot) || !Directory.Exists(steamRoot)) return list;

            list.Add(Path.Combine(steamRoot, @"steamapps\common\shapez.io"));

            string vdfPath = Path.Combine(steamRoot, @"steamapps\libraryfolders.vdf");
            if (File.Exists(vdfPath))
            {
                try
                {
                    string content = File.ReadAllText(vdfPath);
                    var matches = Regex.Matches(content, @"""path""\s+""([^""]+)""");
                    foreach (Match m in matches)
                    {
                        string libPath = m.Groups[1].Value.Replace(@"\\", @"\");
                        string shapezPath = Path.Combine(libPath, @"steamapps\common\shapez.io");
                        list.Add(shapezPath);
                    }
                }
                catch { }
            }

            return list;
        }

        public static bool IsValidShapezDir(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return false;
            string asar = Path.Combine(dir, @"resources\app.asar");
            string exe = Path.Combine(dir, "shapezio.exe");
            return File.Exists(asar) || File.Exists(exe);
        }

        public static string GetModsDir()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, @"shapez.io\mods");
        }

        public static string GetModFilePath()
        {
            return Path.Combine(GetModsDir(), "steam_multiplayer.js");
        }

        public static byte[] GetEmbeddedFile(string resourceName)
        {
            var asm = Assembly.GetExecutingAssembly();
            // Look for resource name ending with resourceName
            foreach (var name in asm.GetManifestResourceNames())
            {
                if (name.EndsWith(resourceName, StringComparison.OrdinalIgnoreCase))
                {
                    using (var s = asm.GetManifestResourceStream(name))
                    {
                        if (s != null)
                        {
                            byte[] buf = new byte[s.Length];
                            s.Read(buf, 0, buf.Length);
                            return buf;
                        }
                    }
                }
            }
            throw new Exception("Embedded resource not found: " + resourceName);
        }

        public static bool IsModInstalled(string shapezDir)
        {
            string asarPath = Path.Combine(shapezDir, @"resources\app.asar");
            string modFile = GetModFilePath();

            if (!File.Exists(modFile) || !File.Exists(asarPath))
                return false;

            try
            {
                using (var fs = File.OpenRead(asarPath))
                using (var br = new BinaryReader(fs))
                {
                    fs.Seek(4, SeekOrigin.Begin);
                    uint headerSize = br.ReadUInt32();
                    fs.Seek(12, SeekOrigin.Begin);
                    uint jsonLen = br.ReadUInt32();
                    byte[] jsonBytes = br.ReadBytes((int)jsonLen);
                    string jsonStr = Encoding.UTF8.GetString(jsonBytes);

                    var serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = int.MaxValue;
                    var dict = serializer.Deserialize<Dictionary<string, object>>(jsonStr);
                    if (dict != null && dict.ContainsKey("files"))
                    {
                        var files = dict["files"] as Dictionary<string, object>;
                        if (files != null && files.ContainsKey("index.js"))
                        {
                            var idxObj = files["index.js"] as Dictionary<string, object>;
                            if (idxObj != null && idxObj.ContainsKey("offset"))
                            {
                                long offset = Convert.ToInt64(idxObj["offset"]);
                                long size = Convert.ToInt64(idxObj["size"]);
                                long payloadStart = 8 + headerSize;
                                fs.Seek(payloadStart + offset, SeekOrigin.Begin);
                                byte[] idxBytes = br.ReadBytes((int)Math.Min(size, 2048));
                                string content = Encoding.UTF8.GetString(idxBytes);
                                if (content.Contains("allowMultiInstance") || content.Contains("steam:mp"))
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            catch { }

            return false;
        }

        private static Dictionary<string, object> ComputeIntegrity(byte[] buffer)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hashBytes = sha.ComputeHash(buffer);
                var sb = new StringBuilder();
                foreach (byte b in hashBytes)
                {
                    sb.Append(b.ToString("x2"));
                }
                string hash = sb.ToString();

                var integrity = new Dictionary<string, object>();
                integrity["algorithm"] = "SHA256";
                integrity["hash"] = hash;
                integrity["blockSize"] = 4194304;
                integrity["blocks"] = new string[] { hash };
                return integrity;
            }
        }

        private static byte[] ExtractAsarFile(byte[] rawAsar, Dictionary<string, object> headerObj, uint headerSize, string fileName)
        {
            var files = headerObj["files"] as Dictionary<string, object>;
            if (files == null || !files.ContainsKey(fileName)) return null;
            var entry = files[fileName] as Dictionary<string, object>;
            if (entry == null || !entry.ContainsKey("offset") || !entry.ContainsKey("size")) return null;
            long offset = Convert.ToInt64(entry["offset"]);
            long size = Convert.ToInt64(entry["size"]);
            long payloadStart = 8 + headerSize;
            byte[] result = new byte[size];
            Buffer.BlockCopy(rawAsar, (int)(payloadStart + offset), result, 0, (int)size);
            return result;
        }

        private static string PatchIndexJs(string src)
        {
            string outStr = src;
            if (!outStr.Contains("allowMultiInstance"))
            {
                outStr = Regex.Replace(
                    outStr,
                    @"const\s+externalMod\s*=\s*app\.commandLine\.getSwitchValue\(""load-mod""\);",
                    "const allowMultiInstance = app.commandLine.hasSwitch(\"multi-instance\");\nconst externalMod = app.commandLine.getSwitchValue(\"load-mod\");\nconst instanceId = app.commandLine.getSwitchValue(\"instance-id\") || (allowMultiInstance ? String(process.pid) : \"\");"
                );
                outStr = Regex.Replace(
                    outStr,
                    @"let\s+storePath\s*=\s*path\.join\(roamingFolder,\s*""shapez\.io"",\s*""saves""\);",
                    "if (allowMultiInstance && instanceId) {\n    const customUserData = path.join(roamingFolder, \"shapez.io\", \"instances\", \"instance-\" + instanceId);\n    fs.mkdirSync(customUserData, { recursive: true });\n    app.setPath(\"userData\", customUserData);\n}\n\nlet storePath =\n    allowMultiInstance && instanceId\n        ? path.join(roamingFolder, \"shapez.io\", \"saves-\" + instanceId)\n        : path.join(roamingFolder, \"shapez.io\", \"saves\");"
                );
                outStr = Regex.Replace(
                    outStr,
                    @"title:\s*""shapez"",",
                    "title: allowMultiInstance ? \"shapez (Co-op Instance)\" : \"shapez\","
                );
                outStr = Regex.Replace(
                    outStr,
                    @"mainWindowState\.manage\(win\);",
                    "steam.setMainWindow(win);\n\n    if (!allowMultiInstance) {\n        mainWindowState.manage(win);\n    }"
                );
                outStr = Regex.Replace(
                    outStr,
                    @"win\.on\(""closed"",\s*\(\)\s*=>\s*\{[\r\n\s]*console\.log\(""Window closed""\);[\r\n\s]*win\s*=\s*null;[\r\n\s]*\}\);",
                    "win.on(\"closed\", () => {\n        console.log(\"Window closed\");\n        steam.setMainWindow(null);\n        win = null;\n    });"
                );
                outStr = Regex.Replace(
                    outStr,
                    @"if\s*\(!app\.requestSingleInstanceLock\(\)\)\s*\{[\r\n\s]*app\.exit\(0\);[\r\n\s]*\}\s*else\s*\{",
                    "if (!allowMultiInstance && !app.requestSingleInstanceLock()) {\n    app.exit(0);\n} else if (!allowMultiInstance) {"
                );
            }

            outStr = Regex.Replace(
                outStr,
                @"steam\.init\(isDev\);[\s\S]*?if\s*\(mods\.length\s*===\s*0\)\s*\{\s*steam\.listen\(\);\s*\}",
                "steam.init(isDev, allowMultiInstance);\nsteam.listen();"
            );

            return outStr;
        }

        private static string PatchPreloadJs(string src)
        {
            string outStr = src;
            if (!outStr.Contains("removeListener"))
            {
                outStr = Regex.Replace(
                    outStr,
                    @"on:\s*ipcRenderer\.on\.bind\(ipcRenderer\),?",
                    "on: (channel, listener) => {\n        const wrapped = (event, ...args) => listener(event, ...args);\n        ipcRenderer.on(channel, wrapped);\n        return () => ipcRenderer.removeListener(channel, wrapped);\n    },"
                );
            }
            return outStr;
        }

        private static string PatchSteamJs(string src)
        {
            string outStr = src;
            if (!outStr.Contains("steam_bridge"))
            {
                outStr += "\n// Hook shapez-steam-multiplayer-mod bridge\ntry {\n    const _steamBridge = require(\"./steam_bridge\");\n    module.exports = _steamBridge;\n} catch (err) {\n    console.warn(\"Failed to load steam_bridge:\", err);\n}\n";
            }
            return outStr;
        }

        public static void PatchAsar(string sourceAsarPath, string targetAsarPath, Dictionary<string, byte[]> replacements)
        {
            byte[] rawAsar = File.ReadAllBytes(sourceAsarPath);

            uint picklePayloadSize = BitConverter.ToUInt32(rawAsar, 0);
            if (picklePayloadSize != 4)
            {
                throw new Exception("Invalid ASAR header (expected pickle payload size 4, got " + picklePayloadSize + ")");
            }

            uint headerSize = BitConverter.ToUInt32(rawAsar, 4);
            uint jsonByteLength = BitConverter.ToUInt32(rawAsar, 12);
            int payloadOffset = (int)(8 + headerSize);

            string headerJsonStr = Encoding.UTF8.GetString(rawAsar, 16, (int)jsonByteLength);
            var serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            var headerObj = serializer.Deserialize<Dictionary<string, object>>(headerJsonStr);

            var filesDict = headerObj["files"] as Dictionary<string, object>;
            if (filesDict == null)
            {
                throw new Exception("ASAR header does not contain 'files' object.");
            }

            int originalPayloadLen = rawAsar.Length - payloadOffset;
            byte[] originalPayload = new byte[originalPayloadLen];
            Buffer.BlockCopy(rawAsar, payloadOffset, originalPayload, 0, originalPayloadLen);

            long currentEndOffset = originalPayloadLen;
            var appendedBuffers = new List<byte[]>();

            foreach (var kvp in replacements)
            {
                string fileName = kvp.Key;
                byte[] fileBuffer = kvp.Value;

                var fileEntry = new Dictionary<string, object>();
                fileEntry["size"] = fileBuffer.Length;
                fileEntry["offset"] = currentEndOffset.ToString();
                fileEntry["integrity"] = ComputeIntegrity(fileBuffer);

                filesDict[fileName] = fileEntry;
                appendedBuffers.Add(fileBuffer);
                currentEndOffset += fileBuffer.Length;
            }

            string newHeaderJsonStr = serializer.Serialize(headerObj);
            var utf8NoBom = new UTF8Encoding(false);
            byte[] newHeaderJsonBuf = utf8NoBom.GetBytes(newHeaderJsonStr);

            int newJsonLen = newHeaderJsonBuf.Length;
            int innerPickleSize = (int)Math.Ceiling((4.0 + newJsonLen) / 4.0) * 4;
            int newHeaderSize = innerPickleSize + 4;

            byte[] newHeaderPrefix = new byte[8 + newHeaderSize];
            BitConverter.GetBytes((uint)4).CopyTo(newHeaderPrefix, 0);
            BitConverter.GetBytes((uint)newHeaderSize).CopyTo(newHeaderPrefix, 4);
            BitConverter.GetBytes((uint)innerPickleSize).CopyTo(newHeaderPrefix, 8);
            BitConverter.GetBytes((uint)newJsonLen).CopyTo(newHeaderPrefix, 12);
            Buffer.BlockCopy(newHeaderJsonBuf, 0, newHeaderPrefix, 16, newJsonLen);

            using (var fs = new FileStream(targetAsarPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(newHeaderPrefix, 0, newHeaderPrefix.Length);
                fs.Write(originalPayload, 0, originalPayload.Length);
                foreach (var buf in appendedBuffers)
                {
                    fs.Write(buf, 0, buf.Length);
                }
            }
        }

        public static void Install(string shapezDir, Action<string> log)
        {
            if (log == null) log = s => { };

            string resourcesDir = Path.Combine(shapezDir, "resources");
            string asarPath = Path.Combine(resourcesDir, "app.asar");
            string backupPath = Path.Combine(resourcesDir, "app.asar.vanilla.bak");

            if (!File.Exists(asarPath))
            {
                throw new FileNotFoundException("Could not find shapez.io app.asar at:\n" + asarPath);
            }

            // 1. Vanilla backup
            if (!File.Exists(backupPath))
            {
                log("Creating vanilla backup at:\n" + backupPath);
                File.Copy(asarPath, backupPath, false);
            }
            else
            {
                log("Using existing vanilla backup at:\n" + backupPath);
            }

            // 2. Patch ASAR
            log("Dynamically patching Steamworks/Lobby IPC bridge into app.asar...");
            byte[] rawAsar = File.ReadAllBytes(backupPath);
            uint headerSize = BitConverter.ToUInt32(rawAsar, 4);
            uint jsonByteLength = BitConverter.ToUInt32(rawAsar, 12);
            string headerJsonStr = Encoding.UTF8.GetString(rawAsar, 16, (int)jsonByteLength);
            var serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            var headerObj = serializer.Deserialize<Dictionary<string, object>>(headerJsonStr);

            byte[] idxBytes = ExtractAsarFile(rawAsar, headerObj, headerSize, "index.js");
            byte[] prlBytes = ExtractAsarFile(rawAsar, headerObj, headerSize, "preload.js");
            byte[] stmBytes = ExtractAsarFile(rawAsar, headerObj, headerSize, "steam.js");

            if (idxBytes == null || prlBytes == null || stmBytes == null)
            {
                throw new Exception("Source app.asar does not contain required files (index.js, preload.js, steam.js).");
            }

            string patchedIndex = PatchIndexJs(Encoding.UTF8.GetString(idxBytes));
            string patchedPreload = PatchPreloadJs(Encoding.UTF8.GetString(prlBytes));
            string patchedSteam = PatchSteamJs(Encoding.UTF8.GetString(stmBytes));
            byte[] bridgeBytes = GetEmbeddedFile("steam_bridge.js");

            var replacements = new Dictionary<string, byte[]>
            {
                { "index.js", Encoding.UTF8.GetBytes(patchedIndex) },
                { "preload.js", Encoding.UTF8.GetBytes(patchedPreload) },
                { "steam.js", Encoding.UTF8.GetBytes(patchedSteam) },
                { "steam_bridge.js", bridgeBytes }
            };

            // Temporary file to avoid corruption if interrupted
            string tempAsar = asarPath + ".tmp";
            PatchAsar(backupPath, tempAsar, replacements);

            if (File.Exists(asarPath))
            {
                File.Delete(asarPath);
            }
            File.Move(tempAsar, asarPath);
            log("app.asar patched successfully!");

            // 3. Mod file in %APPDATA%\shapez.io\mods
            string modsDir = GetModsDir();
            string modFilePath = GetModFilePath();
            if (!Directory.Exists(modsDir))
            {
                Directory.CreateDirectory(modsDir);
            }

            log("Deploying steam_multiplayer.js to:\n" + modFilePath);
            byte[] modBytes = GetEmbeddedFile("steam_multiplayer.js");
            File.WriteAllBytes(modFilePath, modBytes);

            log("\nInstallation complete! You are ready to play Steam Co-op!");
        }

        public static void Uninstall(string shapezDir, Action<string> log)
        {
            if (log == null) log = s => { };

            string resourcesDir = Path.Combine(shapezDir, "resources");
            string asarPath = Path.Combine(resourcesDir, "app.asar");
            string backupPath = Path.Combine(resourcesDir, "app.asar.vanilla.bak");
            string modFilePath = GetModFilePath();

            if (File.Exists(backupPath))
            {
                log("Restoring vanilla app.asar from backup...");
                File.Copy(backupPath, asarPath, true);
                log("Vanilla app.asar restored.");
            }
            else
            {
                log("No vanilla backup (app.asar.vanilla.bak) found.");
            }

            if (File.Exists(modFilePath))
            {
                log("Removing steam_multiplayer.js from mods folder...");
                File.Delete(modFilePath);
                log("Mod file removed.");
            }
            else
            {
                log("Mod file was not present in %APPDATA%\\shapez.io\\mods.");
            }

            log("\nUninstall complete! Game is back to 100% vanilla.");
        }
    }

    public class MainForm : Form
    {
        private TextBox txtPath;
        private Button btnBrowse;
        private Label lblStatus;
        private TextBox txtLog;
        private Button btnInstall;
        private Button btnUninstall;
        private Button btnLaunch;

        public MainForm()
        {
            InitUI();
            RefreshStatus();
        }

        private void InitUI()
        {
            Text = "shapez.io — Steam Co-op Mod Installer";
            Width = 620;
            Height = 460;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.25f);
            BackColor = Color.FromArgb(248, 249, 250);

            var lblHeader = new Label
            {
                Text = "shapez.io Steam Co-op Multiplayer",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(24, 43, 73),
                Location = new Point(20, 16),
                AutoSize = true
            };
            Controls.Add(lblHeader);

            var lblSub = new Label
            {
                Text = "Play shapez together with friends via Steam Lobbies, overlay invites, and live factory sync.",
                ForeColor = Color.FromArgb(90, 100, 115),
                Location = new Point(22, 48),
                Size = new Size(560, 20)
            };
            Controls.Add(lblSub);

            var grpPath = new GroupBox
            {
                Text = "shapez.io Installation Folder",
                Location = new Point(20, 75),
                Size = new Size(560, 65),
                ForeColor = Color.FromArgb(60, 70, 85)
            };
            Controls.Add(grpPath);

            txtPath = new TextBox
            {
                Location = new Point(15, 25),
                Size = new Size(430, 24),
                Text = InstallerLogic.FindShapezDirectory()
            };
            txtPath.TextChanged += (s, e) => RefreshStatus();
            grpPath.Controls.Add(txtPath);

            btnBrowse = new Button
            {
                Text = "Browse...",
                Location = new Point(455, 23),
                Size = new Size(90, 28),
                UseVisualStyleBackColor = true
            };
            btnBrowse.Click += BtnBrowse_Click;
            grpPath.Controls.Add(btnBrowse);

            lblStatus = new Label
            {
                Location = new Point(22, 148),
                Size = new Size(560, 22),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            Controls.Add(lblStatus);

            txtLog = new TextBox
            {
                Location = new Point(20, 175),
                Size = new Size(560, 175),
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                ReadOnly = true,
                BackColor = Color.FromArgb(240, 243, 246),
                Font = new Font("Consolas", 9f)
            };
            Controls.Add(txtLog);

            btnInstall = new Button
            {
                Text = "Install / Update Mod",
                Location = new Point(20, 365),
                Size = new Size(170, 38),
                BackColor = Color.FromArgb(28, 110, 242),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += BtnInstall_Click;
            Controls.Add(btnInstall);

            btnUninstall = new Button
            {
                Text = "Restore Vanilla",
                Location = new Point(200, 365),
                Size = new Size(130, 38),
                BackColor = Color.FromArgb(235, 238, 242),
                ForeColor = Color.FromArgb(70, 80, 95),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnUninstall.FlatAppearance.BorderSize = 0;
            btnUninstall.Click += BtnUninstall_Click;
            Controls.Add(btnUninstall);

            btnLaunch = new Button
            {
                Text = "Launch shapez via Steam",
                Location = new Point(380, 365),
                Size = new Size(200, 38),
                BackColor = Color.FromArgb(46, 125, 50),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnLaunch.FlatAppearance.BorderSize = 0;
            btnLaunch.Click += BtnLaunch_Click;
            Controls.Add(btnLaunch);
        }

        private void AppendLog(string message)
        {
            if (txtLog.InvokeRequired)
            {
                txtLog.Invoke(new Action(() => AppendLog(message)));
                return;
            }
            txtLog.AppendText(message + "\r\n");
        }

        private void RefreshStatus()
        {
            string path = txtPath.Text.Trim();
            if (!InstallerLogic.IsValidShapezDir(path))
            {
                lblStatus.Text = "Status: shapez.io not found at this folder. Please click Browse.";
                lblStatus.ForeColor = Color.FromArgb(180, 40, 40);
                btnInstall.Enabled = false;
                btnUninstall.Enabled = false;
                return;
            }

            bool installed = InstallerLogic.IsModInstalled(path);
            if (installed)
            {
                lblStatus.Text = "Status: Co-op Multiplayer Mod is currently installed! (v1.0.0)";
                lblStatus.ForeColor = Color.FromArgb(30, 130, 60);
                btnInstall.Text = "Reinstall / Update";
            }
            else
            {
                lblStatus.Text = "Status: Ready to install. Game is currently unpatched (Vanilla).";
                lblStatus.ForeColor = Color.FromArgb(20, 80, 160);
                btnInstall.Text = "Install Mod";
            }

            btnInstall.Enabled = true;
            btnUninstall.Enabled = true;
        }

        private void BtnBrowse_Click(object sender, EventArgs e)
        {
            using (var fbd = new FolderBrowserDialog())
            {
                fbd.Description = "Select shapez.io Game Folder (where shapezio.exe or resources\\app.asar is located)";
                fbd.SelectedPath = txtPath.Text;
                if (fbd.ShowDialog() == DialogResult.OK)
                {
                    txtPath.Text = fbd.SelectedPath;
                    RefreshStatus();
                }
            }
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            string path = txtPath.Text.Trim();
            txtLog.Clear();
            AppendLog("=== Starting Installation ===");

            btnInstall.Enabled = false;
            btnUninstall.Enabled = false;

            try
            {
                InstallerLogic.Install(path, AppendLog);
                RefreshStatus();
                MessageBox.Show(
                    "Mod installed successfully!\n\nYou can now launch shapez.io from Steam. Click 'Steam Multiplayer' on the main menu to host or join friends!",
                    "shapez.io Steam Co-op Mod",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog("\nERROR: " + ex.Message);
                MessageBox.Show(
                    "Installation failed:\n" + ex.Message,
                    "Installation Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            finally
            {
                btnInstall.Enabled = true;
                btnUninstall.Enabled = true;
            }
        }

        private void BtnUninstall_Click(object sender, EventArgs e)
        {
            string path = txtPath.Text.Trim();
            txtLog.Clear();
            AppendLog("=== Restoring Vanilla Game ===");

            btnInstall.Enabled = false;
            btnUninstall.Enabled = false;

            try
            {
                InstallerLogic.Uninstall(path, AppendLog);
                RefreshStatus();
                MessageBox.Show(
                    "Game successfully restored to vanilla state.",
                    "shapez.io Steam Co-op Mod",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                AppendLog("\nERROR: " + ex.Message);
                MessageBox.Show(
                    "Restore failed:\n" + ex.Message,
                    "Restore Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            finally
            {
                btnInstall.Enabled = true;
                btnUninstall.Enabled = true;
            }
        }

        private void BtnLaunch_Click(object sender, EventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "steam://run/1318690",
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not launch Steam game:\n" + ex.Message, "Launch Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    public static class Program
    {
        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int dwProcessId);
        private const int ATTACH_PARENT_PROCESS = -1;

        [STAThread]
        public static int Main(string[] args)
        {
            bool isSilent = false;
            bool isUninstall = false;
            string customPath = null;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                if (a == "--help" || a == "-h" || a == "/?" || a == "-?")
                {
                    AttachConsole(ATTACH_PARENT_PROCESS);
                    Console.WriteLine("\nshapez.io Steam Co-op Multiplayer Installer v1.0.0");
                    Console.WriteLine("Usage: ShapezCoopInstaller.exe [options]");
                    Console.WriteLine("  --silent, -s       Install mod and patches quietly without UI");
                    Console.WriteLine("  --uninstall, -u    Uninstall mod and restore vanilla shapez.io");
                    Console.WriteLine("  --path <dir>       Specify custom shapez.io installation path");
                    Console.WriteLine("  --help, -h         Show this help message");
                    return 0;
                }
                else if (a == "--version" || a == "-v")
                {
                    AttachConsole(ATTACH_PARENT_PROCESS);
                    Console.WriteLine("1.0.0");
                    return 0;
                }
                else if (a == "--silent" || a == "-s" || a == "/silent") isSilent = true;
                else if (a == "--uninstall" || a == "-u" || a == "/uninstall") isUninstall = true;
                else if (a == "--path" && i + 1 < args.Length)
                {
                    customPath = args[++i];
                }
            }

            if (isSilent)
            {
                AttachConsole(ATTACH_PARENT_PROCESS);
                Console.WriteLine("\n[shapez.io Co-op Installer] Running in silent mode...");
                string path = !string.IsNullOrEmpty(customPath) ? customPath : InstallerLogic.FindShapezDirectory();
                try
                {
                    if (isUninstall)
                    {
                        InstallerLogic.Uninstall(path, Console.WriteLine);
                    }
                    else
                    {
                        InstallerLogic.Install(path, Console.WriteLine);
                    }
                    return 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("\n[ERROR] " + ex.Message);
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }
    }
}
