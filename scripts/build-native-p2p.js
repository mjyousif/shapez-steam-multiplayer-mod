const fs = require("fs");
const path = require("path");

/**
 * Generates src/steam_p2p_win64.node — a compact, zero-dependency Windows x64 N-API native addon
 * that dynamically resolves N-API from the host process (shapezio.exe / node.exe) and
 * ISteamNetworking / ISteamFriends / ISteamMatchmaking functions from steam_api64.dll.
 *
 * Exposed JS methods:
 * - init(): boolean
 * - sendP2PPacket(steamIdBuf8, dataBuf, sendType, channel): boolean
 * - readP2PPacket(channel): Buffer (8-byte LE remoteSteamId + payload) | null
 * - acceptP2PSession(steamIdBuf8): boolean
 * - closeP2PSession(steamIdBuf8): boolean
 * - requestFriendRichPresence(steamIdBuf8): boolean
 * - requestLobbyData(lobbyIdBuf8): boolean
 * - sendLobbyChatMsg(lobbyIdBuf8, dataBuf): boolean
 * - getLobbyChatEntry(lobbyIdBuf8, chatIndex): Buffer (8-byte LE senderSteamId + payload) | null
 */

const RVA_TEXT = 0x1000;
const RVA_RDATA = 0x2000;
const RVA_DATA = 0x3000;
const RVA_RELOC = 0x4000;

const FILE_ALIGN = 0x200;
const SECT_ALIGN = 0x1000;

const OFF_TEXT = 0x400;
const SIZE_TEXT = 0x1000;
const OFF_RDATA = OFF_TEXT + SIZE_TEXT; // 0x1400
const SIZE_RDATA = 0x800;
const OFF_DATA = OFF_RDATA + SIZE_RDATA; // 0x1C00
const SIZE_DATA = 0x400;
const OFF_RELOC = OFF_DATA + SIZE_DATA; // 0x2000
const SIZE_RELOC = 0x200;
const TOTAL_FILE_SIZE = OFF_RELOC + SIZE_RELOC; // 0x2200 (8,704 bytes)

const buf = Buffer.alloc(TOTAL_FILE_SIZE, 0);

// ============================================================================
// 1. Build .rdata section (Imports, Exports, Strings) at RVA 0x2000 (File 0xC00)
// ============================================================================

let rdataCursor = 0;
function allocRdata(bytes, align = 1) {
    while (rdataCursor % align !== 0) rdataCursor++;
    const rva = RVA_RDATA + rdataCursor;
    bytes.copy(buf, OFF_RDATA + rdataCursor);
    rdataCursor += bytes.length;
    return rva;
}
function allocCString(str) {
    return allocRdata(Buffer.from(str + "\0", "ascii"), 1);
}

// Import Lookup Table (ILT) & Import Address Table (IAT) for KERNEL32.dll
// Two imports: GetModuleHandleA, GetProcAddress
const rvaHintGetModuleHandleA = allocRdata(Buffer.concat([Buffer.from([0, 0]), Buffer.from("GetModuleHandleA\0", "ascii")]), 2);
const rvaHintGetProcAddress = allocRdata(Buffer.concat([Buffer.from([0, 0]), Buffer.from("GetProcAddress\0", "ascii")]), 2);
const rvaKernel32Name = allocCString("KERNEL32.dll");

const iltBuf = Buffer.alloc(24, 0);
iltBuf.writeBigUInt64LE(BigInt(rvaHintGetModuleHandleA), 0);
iltBuf.writeBigUInt64LE(BigInt(rvaHintGetProcAddress), 8);
const rvaILT = allocRdata(iltBuf, 8);

const iatBuf = Buffer.alloc(24, 0);
iatBuf.writeBigUInt64LE(BigInt(rvaHintGetModuleHandleA), 0);
iatBuf.writeBigUInt64LE(BigInt(rvaHintGetProcAddress), 8);
const rvaIAT = allocRdata(iatBuf, 8);
const rvaIAT_GetModuleHandleA = rvaIAT;
const rvaIAT_GetProcAddress = rvaIAT + 8;

// Import Directory Table (2 entries: KERNEL32.dll + null terminator)
const idtBuf = Buffer.alloc(40, 0);
idtBuf.writeUInt32LE(rvaILT, 0); // OriginalFirstThunk
idtBuf.writeUInt32LE(0, 4); // TimeDateStamp
idtBuf.writeUInt32LE(0, 8); // ForwarderChain
idtBuf.writeUInt32LE(rvaKernel32Name, 12); // Name
idtBuf.writeUInt32LE(rvaIAT, 16); // FirstThunk
const rvaIDT = allocRdata(idtBuf, 4);

// Strings for N-API functions
const NAPI_FUNCS = [
    "napi_create_function", // 0
    "napi_set_named_property", // 1
    "napi_get_cb_info", // 2
    "napi_get_buffer_info", // 3
    "napi_get_value_int32", // 4
    "napi_get_boolean", // 5
    "napi_get_null", // 6
    "napi_create_buffer", // 7
];
const rvaNapiNames = NAPI_FUNCS.map(s => allocCString(s));

// Strings for steam_api64.dll and SteamAPI functions
const rvaSteamDllName = allocCString("steam_api64.dll");
const STEAM_FUNCS = [
    "SteamAPI_GetHSteamUser", // 0
    "SteamInternal_FindOrCreateUserInterface", // 1
    "SteamAPI_ISteamNetworking_AllowP2PPacketRelay", // 2
    "SteamAPI_ISteamNetworking_SendP2PPacket", // 3
    "SteamAPI_ISteamNetworking_IsP2PPacketAvailable", // 4
    "SteamAPI_ISteamNetworking_ReadP2PPacket", // 5
    "SteamAPI_ISteamNetworking_AcceptP2PSessionWithUser", // 6
    "SteamAPI_ISteamNetworking_CloseP2PSessionWithUser", // 7
    "SteamAPI_ISteamFriends_RequestFriendRichPresence", // 8
    "SteamAPI_ISteamMatchmaking_RequestLobbyData", // 9
    "SteamAPI_ISteamMatchmaking_SendLobbyChatMsg", // 10
    "SteamAPI_ISteamMatchmaking_GetLobbyChatEntry", // 11
    "SteamAPI_RegisterCallback", // 12
];
const rvaSteamNames = STEAM_FUNCS.map(s => allocCString(s));

const rvaVerNetworking6 = allocCString("SteamNetworking006");
const rvaVerNetworking5 = allocCString("SteamNetworking005");
const rvaVerFriends = allocCString("SteamFriends017");
const rvaVerMatchmaking = allocCString("SteamMatchMaking009");

// Exported JS property names
const JS_EXPORTS = [
    "init",
    "sendP2PPacket",
    "readP2PPacket",
    "acceptP2PSession",
    "closeP2PSession",
    "requestFriendRichPresence",
    "requestLobbyData",
    "sendLobbyChatMsg",
    "getLobbyChatEntry",
];
const rvaJsExportNames = JS_EXPORTS.map(s => allocCString(s));

// ============================================================================
// 2. Layout of .data section at RVA 0x3000 (File 0x1400)
// ============================================================================
// 0x3000 .. 0x3038: NAPI function pointers (8 * 8 = 64 bytes)
// 0x3040 .. 0x30A0: Steam function pointers (13 * 8 = 104 bytes)
// 0x30A8: ptr_ISteamNetworking
// 0x30B0: ptr_ISteamFriends
// 0x30B8: ptr_ISteamMatchmaking
// 0x30C0: callback_registered (uint64)
// 0x30D0: CCallbackBase struct (32 bytes):
//         0x30D0: vtable_ptr -> points to 0x30F0
//         0x30D8: m_nCallbackFlags (1 byte) + pad (3 bytes) + m_iCallback (4 bytes)
// 0x30F0: vtable for CCallbackBase (3 * 8 = 24 bytes):
//         0x30F0: ptr to cb_OnP2PSessionRequest
//         0x30F8: ptr to cb_OnP2PSessionRequest
//         0x3100: ptr to cb_GetCallbackSizeBytes
// 0x3110: scratch area (msgSize, remoteSteamId, chatEntryType, etc.)
// 0x3200: 4096-byte scratch buffer for getLobbyChatEntry

const DATA_NAPI_BASE = RVA_DATA + 0x00;
const DATA_STEAM_BASE = RVA_DATA + 0x40;
const DATA_PTR_NET = RVA_DATA + 0xA8;
const DATA_PTR_FRIENDS = RVA_DATA + 0xB0;
const DATA_PTR_MM = RVA_DATA + 0xB8;
const DATA_CB_REGISTERED = RVA_DATA + 0xC0;
const DATA_CB_STRUCT = RVA_DATA + 0xD0;
const DATA_CB_VTABLE = RVA_DATA + 0xF0;
const DATA_SCRATCH = RVA_DATA + 0x110;
const DATA_CHAT_BUF = RVA_DATA + 0x180; // 512 bytes in .data is plenty, or we can use stack

// ============================================================================
// 3. Tiny x64 Assembler Helper for .text at RVA 0x1000 (File 0x400)
// ============================================================================

class Asm {
    constructor(baseRva) {
        this.baseRva = baseRva;
        this.bytes = [];
        this.labels = new Map();
        this.fixups = []; // { offset, targetLabel, targetRva }
    }
    get pc() {
        return this.baseRva + this.bytes.length;
    }
    emit(...b) {
        for (const x of b) this.bytes.push(x & 0xff);
    }
    emitU32(val) {
        this.emit(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
    }
    align16() {
        while (this.bytes.length % 16 !== 0) this.emit(0xcc);
    }
    label(name) {
        this.align16();
        this.labels.set(name, this.pc);
        return this.pc;
    }
    localLabel(name) {
        this.labels.set(name, this.pc);
        return this.pc;
    }
    jzLabel(labelName) {
        this.emit(0x0f, 0x84);
        this.emitRipLabel(labelName);
    }
    jnzLabel(labelName) {
        this.emit(0x0f, 0x85);
        this.emitRipLabel(labelName);
    }
    // RIP-relative disp32 to a known RVA (instruction ends 4 bytes after disp32 start)
    emitRipRva(targetRva, extraAfterDisp = 0) {
        const disp = targetRva - (this.pc + 4 + extraAfterDisp);
        this.emitU32(disp);
    }
    emitRipLabel(labelName, extraAfterDisp = 0) {
        this.fixups.push({
            pos: this.bytes.length,
            nextPc: this.pc + 4 + extraAfterDisp,
            labelName,
        });
        this.emitU32(0);
    }
    // call [rip + disp32] (FF 15 disp32)
    callMemRip(targetRva) {
        this.emit(0xff, 0x15);
        this.emitRipRva(targetRva);
    }
    // mov rax, [rip + disp32] (48 8B 05 disp32)
    movRaxMemRip(targetRva) {
        this.emit(0x48, 0x8b, 0x05);
        this.emitRipRva(targetRva);
    }
    // mov rcx, [rip + disp32] (48 8B 0D disp32)
    movRcxMemRip(targetRva) {
        this.emit(0x48, 0x8b, 0x0d);
        this.emitRipRva(targetRva);
    }
    // mov [rip + disp32], rax (48 89 05 disp32)
    movMemRipRax(targetRva) {
        this.emit(0x48, 0x89, 0x05);
        this.emitRipRva(targetRva);
    }
    // lea rcx, [rip + disp32] (48 8D 0D disp32)
    leaRcxRip(targetRva) {
        this.emit(0x48, 0x8d, 0x0d);
        this.emitRipRva(targetRva);
    }
    // lea rdx, [rip + disp32] (48 8D 15 disp32)
    leaRdxRip(targetRva) {
        this.emit(0x48, 0x8d, 0x15);
        this.emitRipRva(targetRva);
    }
    // lea r9, [rip + disp32] (4C 8D 0D disp32)
    leaR9RipLabel(labelName) {
        this.emit(0x4c, 0x8d, 0x0d);
        this.emitRipLabel(labelName);
    }
    // lea rax, [rip + disp32] (48 8D 05 disp32)
    leaRaxRipLabel(labelName) {
        this.emit(0x48, 0x8d, 0x05);
        this.emitRipLabel(labelName);
    }
    finalize() {
        const out = Buffer.from(this.bytes);
        for (const f of this.fixups) {
            const target = this.labels.get(f.labelName);
            if (target === undefined) throw new Error("Missing label: " + f.labelName);
            out.writeInt32LE(target - f.nextPc, f.pos);
        }
        return out;
    }
}

const a = new Asm(RVA_TEXT);

// ---- DllMain(hinstDLL, fdwReason, lpvReserved) -> returns TRUE (1) ----
const rvaDllMain = a.label("DllMain");
a.emit(0xb8, 0x01, 0x00, 0x00, 0x00); // mov eax, 1
a.emit(0xc3); // ret

// ---- Native Steam Callback: cb_OnP2PSessionRequest(this /*rcx*/, pvParam /*rdx*/) ----
a.label("cb_OnP2PSessionRequest");
// rdx points to P2PSessionRequest_t { uint64_t m_steamIDRemote; }
a.emit(0x48, 0x85, 0xd2); // test rdx, rdx
a.jzLabel("cb_p2p_done");
a.emit(0x48, 0x8b, 0x12); // mov rdx, [rdx] (remoteSteamId)
a.movRcxMemRip(DATA_PTR_NET); // mov rcx, [ptr_ISteamNetworking]
a.emit(0x48, 0x85, 0xc9); // test rcx, rcx
a.jzLabel("cb_p2p_done");
a.emit(0x48, 0x83, 0xec, 0x28); // sub rsp, 0x28
a.callMemRip(DATA_STEAM_BASE + 6 * 8); // call SteamAPI_ISteamNetworking_AcceptP2PSessionWithUser
a.emit(0x48, 0x83, 0xc4, 0x28); // add rsp, 0x28
a.localLabel("cb_p2p_done");
a.emit(0xc3); // ret

// ---- Native Steam Callback: cb_GetCallbackSizeBytes(this /*rcx*/) -> 8 ----
a.label("cb_GetCallbackSizeBytes");
a.emit(0xb8, 0x08, 0x00, 0x00, 0x00); // mov eax, 8
a.emit(0xc3); // ret

// ---- Helper: js_return_bool(env /*rbx*/, boolVal /*edx*/) -> returns napi_value in rax ----
const rvaReturnBool = a.label("js_return_bool");
a.emit(0x48, 0x83, 0xec, 0x38);
a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx
a.emit(0x83, 0xe2, 0x01); // and edx, 1
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x20); // lea r8, [rsp+0x20]
a.callMemRip(DATA_NAPI_BASE + 5 * 8); // call napi_get_boolean
a.emit(0x48, 0x8b, 0x44, 0x24, 0x20); // mov rax, [rsp+0x20]
a.emit(0x48, 0x83, 0xc4, 0x38);
a.emit(0xc3);

// ---- Helper: js_return_null(env /*rbx*/) -> returns napi_value in rax ----
a.label("js_return_null");
a.emit(0x48, 0x83, 0xec, 0x38);
a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx
a.emit(0x48, 0x8d, 0x54, 0x24, 0x20); // lea rdx, [rsp+0x20]
a.callMemRip(DATA_NAPI_BASE + 6 * 8); // call napi_get_null(env, &result)
a.emit(0x48, 0x8b, 0x44, 0x24, 0x20); // mov rax, [rsp+0x20]
a.emit(0x48, 0x83, 0xc4, 0x38);
a.emit(0xc3);

// ---- JS Function 0: js_init(env /*rcx*/, info /*rdx*/) -> boolean ----
a.label("js_init");
a.emit(0x53); // push rbx
a.emit(0x56); // push rsi
a.emit(0x48, 0x83, 0xec, 0x38); // sub rsp, 0x38
a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx (save env)

// hSteamDll = GetModuleHandleA("steam_api64.dll")
a.leaRcxRip(rvaSteamDllName);
a.callMemRip(rvaIAT_GetModuleHandleA);
a.emit(0x48, 0x85, 0xc0); // test rax, rax
a.jzLabel("init_fail");
a.emit(0x48, 0x89, 0xc6); // mov rsi, rax (hSteamDll)

// Resolve all 13 STEAM_FUNCS
for (let i = 0; i < STEAM_FUNCS.length; i++) {
    a.emit(0x48, 0x89, 0xf1); // mov rcx, rsi
    a.leaRdxRip(rvaSteamNames[i]);
    a.callMemRip(rvaIAT_GetProcAddress);
    a.movMemRipRax(DATA_STEAM_BASE + i * 8);
}

// Check if SteamAPI_GetHSteamUser and SteamInternal_FindOrCreateUserInterface exist
a.movRaxMemRip(DATA_STEAM_BASE + 0 * 8);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("init_fail");
a.movRaxMemRip(DATA_STEAM_BASE + 1 * 8);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("init_fail");

// eax = SteamAPI_GetHSteamUser()
a.callMemRip(DATA_STEAM_BASE + 0 * 8);
a.emit(0x89, 0xc6); // mov esi, eax (hSteamUser)

// pNetworking = SteamInternal_FindOrCreateUserInterface(hSteamUser, "SteamNetworking006")
a.emit(0x89, 0xf1); // mov ecx, esi
a.leaRdxRip(rvaVerNetworking6);
a.callMemRip(DATA_STEAM_BASE + 1 * 8);
a.emit(0x48, 0x85, 0xc0);
a.jnzLabel("got_net_iface");
a.emit(0x89, 0xf1); // mov ecx, esi
a.leaRdxRip(rvaVerNetworking5);
a.callMemRip(DATA_STEAM_BASE + 1 * 8);
a.localLabel("got_net_iface");
a.movMemRipRax(DATA_PTR_NET);

// pFriends = SteamInternal_FindOrCreateUserInterface(hSteamUser, "SteamFriends017")
a.emit(0x89, 0xf1); // mov ecx, esi
a.leaRdxRip(rvaVerFriends);
a.callMemRip(DATA_STEAM_BASE + 1 * 8);
a.movMemRipRax(DATA_PTR_FRIENDS);

// pMatchmaking = SteamInternal_FindOrCreateUserInterface(hSteamUser, "SteamMatchMaking009")
a.emit(0x89, 0xf1); // mov ecx, esi
a.leaRdxRip(rvaVerMatchmaking);
a.callMemRip(DATA_STEAM_BASE + 1 * 8);
a.movMemRipRax(DATA_PTR_MM);

// Verify pNetworking != NULL
a.movRcxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x85, 0xc9);
a.jzLabel("init_fail");

// SteamAPI_ISteamNetworking_AllowP2PPacketRelay(pNetworking, 1)
a.emit(0xb2, 0x01); // mov dl, 1
a.callMemRip(DATA_STEAM_BASE + 2 * 8);

// Register P2PSessionRequest_t callback (1202) once
a.movRaxMemRip(DATA_CB_REGISTERED);
a.emit(0x48, 0x85, 0xc0);
a.jnzLabel("skip_cb_reg");
a.movRaxMemRip(DATA_STEAM_BASE + 12 * 8); // SteamAPI_RegisterCallback
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("skip_cb_reg");
// Set up vtable at DATA_CB_VTABLE
a.leaRaxRipLabel("cb_OnP2PSessionRequest");
a.movMemRipRax(DATA_CB_VTABLE + 0);
a.movMemRipRax(DATA_CB_VTABLE + 8);
a.leaRaxRipLabel("cb_GetCallbackSizeBytes");
a.movMemRipRax(DATA_CB_VTABLE + 16);
// Store vtable ptr at DATA_CB_STRUCT
a.leaRcxRip(DATA_CB_VTABLE);
a.emit(0x48, 0x89, 0x0d);
a.emitRipRva(DATA_CB_STRUCT);
// Call SteamAPI_RegisterCallback(&cbStruct, 1202)
a.leaRcxRip(DATA_CB_STRUCT);
a.emit(0xba, 0xb2, 0x04, 0x00, 0x00); // mov edx, 1202
a.callMemRip(DATA_STEAM_BASE + 12 * 8);
a.emit(0xb8, 0x01, 0x00, 0x00, 0x00);
a.movMemRipRax(DATA_CB_REGISTERED);
a.localLabel("skip_cb_reg");

// Return true
a.emit(0xba, 0x01, 0x00, 0x00, 0x00); // mov edx, 1
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x83, 0xc4, 0x38);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

a.localLabel("init_fail");
a.emit(0x31, 0xd2); // xor edx, edx
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x83, 0xc4, 0x38);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

// ---- JS Function 1: js_sendP2PPacket(env, info) ----
// Args: (steamIdBuf8, dataBuf, sendType, channel)
a.label("js_sendP2PPacket");
a.emit(0x53); // push rbx
a.emit(0x56); // push rsi
a.emit(0x57); // push rdi
a.emit(0x48, 0x81, 0xec, 0x80, 0x00, 0x00, 0x00); // sub rsp, 0x80
a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx (env)

// Check ptr_ISteamNetworking
a.movRaxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("send_fail");

// napi_get_cb_info(env, info, &argc, argv, NULL, NULL)
// [rsp+0x30] = argc (4), [rsp+0x40..0x58] = argv[0..3]
a.emit(0x48, 0xc7, 0x44, 0x24, 0x30, 0x04, 0x00, 0x00, 0x00); // mov qword [rsp+0x30], 4
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x30); // lea r8, [rsp+0x30]
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x40); // lea r9, [rsp+0x40]
a.emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00); // [rsp+0x20] = 0
a.emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x00, 0x00, 0x00, 0x00); // [rsp+0x28] = 0
a.callMemRip(DATA_NAPI_BASE + 2 * 8); // napi_get_cb_info

// napi_get_buffer_info(env, argv[0], &idPtr, &idLen)
a.emit(0x48, 0xc7, 0x44, 0x24, 0x60, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx
a.emit(0x48, 0x8b, 0x54, 0x24, 0x40); // mov rdx, [rsp+0x40] (argv[0])
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x60); // lea r8, [rsp+0x60] (idPtr)
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x68); // lea r9, [rsp+0x68] (idLen)
a.callMemRip(DATA_NAPI_BASE + 3 * 8);
a.emit(0x48, 0x8b, 0x44, 0x24, 0x60); // mov rax, [rsp+0x60]
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("send_fail");
a.emit(0x48, 0x8b, 0x30); // mov rsi, [rax] (rsi = uint64 remoteSteamId)

// napi_get_buffer_info(env, argv[1], &dataPtr, &dataLen)
a.emit(0x48, 0xc7, 0x44, 0x24, 0x60, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx
a.emit(0x48, 0x8b, 0x54, 0x24, 0x48); // mov rdx, [rsp+0x48] (argv[1])
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x60); // lea r8, [rsp+0x60] (dataPtr)
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x68); // lea r9, [rsp+0x68] (dataLen)
a.callMemRip(DATA_NAPI_BASE + 3 * 8);
a.emit(0x48, 0x8b, 0x7c, 0x24, 0x60); // mov rdi, [rsp+0x60] (rdi = dataPtr)
a.emit(0x48, 0x85, 0xff);
a.jzLabel("send_fail");

// napi_get_value_int32(env, argv[2], &sendType) -> [rsp+0x70]
a.emit(0xc7, 0x44, 0x24, 0x70, 0x02, 0x00, 0x00, 0x00); // default 2 (Reliable)
a.emit(0x48, 0x89, 0xd9);
a.emit(0x48, 0x8b, 0x54, 0x24, 0x50); // argv[2]
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x70);
a.callMemRip(DATA_NAPI_BASE + 4 * 8);

// napi_get_value_int32(env, argv[3], &channel) -> [rsp+0x74]
a.emit(0xc7, 0x44, 0x24, 0x74, 0x00, 0x00, 0x00, 0x00); // default 0
a.emit(0x48, 0x89, 0xd9);
a.emit(0x48, 0x8b, 0x54, 0x24, 0x58); // argv[3]
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x74);
a.callMemRip(DATA_NAPI_BASE + 4 * 8);

// Call SteamAPI_ISteamNetworking_SendP2PPacket(pNet /*rcx*/, remoteSteamId /*rdx*/, dataPtr /*r8*/, dataLen /*r9d*/, sendType /*[rsp+0x20]*/, channel /*[rsp+0x28]*/)
a.movRcxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x89, 0xf2); // mov rdx, rsi
a.emit(0x49, 0x89, 0xf8); // mov r8, rdi
a.emit(0x44, 0x8b, 0x4c, 0x24, 0x68); // mov r9d, dword [rsp+0x68]
a.emit(0x8b, 0x44, 0x24, 0x70); // mov eax, [rsp+0x70] (sendType)
a.emit(0x89, 0x44, 0x24, 0x20); // mov [rsp+0x20], eax
a.emit(0x8b, 0x44, 0x24, 0x74); // mov eax, [rsp+0x74] (channel)
a.emit(0x89, 0x44, 0x24, 0x28); // mov [rsp+0x28], eax
a.callMemRip(DATA_STEAM_BASE + 3 * 8);

a.emit(0x0f, 0xb6, 0xd0); // movzx edx, al
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x81, 0xc4, 0x80, 0x00, 0x00, 0x00);
a.emit(0x5f);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

a.localLabel("send_fail");
a.emit(0x31, 0xd2); // xor edx, edx
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x81, 0xc4, 0x80, 0x00, 0x00, 0x00);
a.emit(0x5f);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

// ---- JS Function 2: js_readP2PPacket(env, info) -> Buffer | null ----
// Args: (channel)
a.label("js_readP2PPacket");
a.emit(0x53); // push rbx
a.emit(0x56); // push rsi
a.emit(0x57); // push rdi
a.emit(0x48, 0x83, 0xec, 0x60); // sub rsp, 0x60
a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx (env)

a.movRaxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("read_null");

// napi_get_cb_info(env, info, &argc=1, &argv0, NULL, NULL)
a.emit(0x48, 0xc7, 0x44, 0x24, 0x30, 0x01, 0x00, 0x00, 0x00);
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x30);
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x38);
a.emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x00, 0x00, 0x00, 0x00);
a.callMemRip(DATA_NAPI_BASE + 2 * 8);

// channel = 0 default, napi_get_value_int32(env, argv0, &channel [rsp+0x40])
a.emit(0xc7, 0x44, 0x24, 0x40, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9);
a.emit(0x48, 0x8b, 0x54, 0x24, 0x38);
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x40);
a.callMemRip(DATA_NAPI_BASE + 4 * 8);
a.emit(0x8b, 0x74, 0x24, 0x40); // mov esi, [rsp+0x40] (channel)

// SteamAPI_ISteamNetworking_IsP2PPacketAvailable(pNet /*rcx*/, &msgSize [rsp+0x44] /*rdx*/, channel /*r8d*/)
a.emit(0xc7, 0x44, 0x24, 0x44, 0x00, 0x00, 0x00, 0x00);
a.movRcxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x8d, 0x54, 0x24, 0x44); // lea rdx, [rsp+0x44]
a.emit(0x41, 0x89, 0xf0); // mov r8d, esi
a.callMemRip(DATA_STEAM_BASE + 4 * 8);
a.emit(0x84, 0xc0); // test al, al
a.jzLabel("read_null");

a.emit(0x8b, 0x7c, 0x24, 0x44); // mov edi, [rsp+0x44] (msgSize)
a.emit(0x85, 0xff); // test edi, edi
a.jzLabel("read_null");

// napi_create_buffer(env /*rcx*/, 8 + msgSize /*rdx*/, &dataPtr [rsp+0x48] /*r8*/, &resultVal [rsp+0x50] /*r9*/)
a.emit(0x48, 0xc7, 0x44, 0x24, 0x48, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx
a.emit(0x8d, 0x57, 0x08); // lea edx, [rdi + 8]
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x48); // lea r8, [rsp+0x48]
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x50); // lea r9, [rsp+0x50]
a.callMemRip(DATA_NAPI_BASE + 7 * 8);

// SteamAPI_ISteamNetworking_ReadP2PPacket(pNet /*rcx*/, dataPtr+8 /*rdx*/, msgSize /*r8d*/, &msgSize [rsp+0x44] /*r9*/, dataPtr /*[rsp+0x20]*/, channel /*[rsp+0x28]*/)
a.emit(0x48, 0x8b, 0x44, 0x24, 0x48); // mov rax, [rsp+0x48] (dataPtr)
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("read_null");
a.movRcxMemRip(DATA_PTR_NET);
a.emit(0x48, 0x8d, 0x50, 0x08); // lea rdx, [rax + 8] (pubDest)
a.emit(0x41, 0x89, 0xf8); // mov r8d, edi (cubDest)
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x44); // lea r9, [rsp+0x44] (&pcubMsgSize)
a.emit(0x48, 0x89, 0x44, 0x24, 0x20); // mov [rsp+0x20], rax (psteamIDRemote = dataPtr)
a.emit(0x89, 0x74, 0x24, 0x28); // mov [rsp+0x28], esi (channel)
a.callMemRip(DATA_STEAM_BASE + 5 * 8);
a.emit(0x84, 0xc0); // test al, al
a.jzLabel("read_null");

a.emit(0x48, 0x8b, 0x44, 0x24, 0x50); // mov rax, [rsp+0x50] (resultVal)
a.emit(0x48, 0x83, 0xc4, 0x60);
a.emit(0x5f);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

a.localLabel("read_null");
a.emit(0xe8);
a.emitRipRva(a.labels.get("js_return_null"));
a.emit(0x48, 0x83, 0xc4, 0x60);
a.emit(0x5f);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

// ---- Helper generator for 1-arg (steamIdBuf8) Steam calls:
//      func(pInterface, uint64 steamId) -> bool ----
function emitOneIdSteamCall(labelName, interfaceDataRva, steamFuncIndex, returnsVoid = false) {
    const failLabel = labelName + "_fail";
    a.label(labelName);
    a.emit(0x53); // push rbx
    a.emit(0x48, 0x83, 0xec, 0x50); // sub rsp, 0x50
    a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx (env)

    a.movRaxMemRip(interfaceDataRva);
    a.emit(0x48, 0x85, 0xc0);
    a.jzLabel(failLabel);

    // napi_get_cb_info(env, info, &argc=1, &argv0, NULL, NULL)
    a.emit(0x48, 0xc7, 0x44, 0x24, 0x30, 0x01, 0x00, 0x00, 0x00);
    a.emit(0x4c, 0x8d, 0x44, 0x24, 0x30);
    a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x38);
    a.emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
    a.emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x00, 0x00, 0x00, 0x00);
    a.callMemRip(DATA_NAPI_BASE + 2 * 8);

    // napi_get_buffer_info(env, argv0, &idPtr [rsp+0x40], &idLen [rsp+0x48])
    a.emit(0x48, 0xc7, 0x44, 0x24, 0x40, 0x00, 0x00, 0x00, 0x00);
    a.emit(0x48, 0x89, 0xd9);
    a.emit(0x48, 0x8b, 0x54, 0x24, 0x38);
    a.emit(0x4c, 0x8d, 0x44, 0x24, 0x40);
    a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x48);
    a.callMemRip(DATA_NAPI_BASE + 3 * 8);

    a.emit(0x48, 0x8b, 0x44, 0x24, 0x40); // mov rax, [rsp+0x40]
    a.emit(0x48, 0x85, 0xc0);
    a.jzLabel(failLabel);
    a.emit(0x48, 0x8b, 0x10); // mov rdx, [rax] (uint64 steamId)
    a.movRcxMemRip(interfaceDataRva);
    a.callMemRip(DATA_STEAM_BASE + steamFuncIndex * 8);
    if (returnsVoid) {
        a.emit(0xba, 0x01, 0x00, 0x00, 0x00); // mov edx, 1
    } else {
        a.emit(0x0f, 0xb6, 0xd0); // movzx edx, al
    }
    a.emit(0xe8);
    a.emitRipRva(rvaReturnBool);
    a.emit(0x48, 0x83, 0xc4, 0x50);
    a.emit(0x5b);
    a.emit(0xc3);

    a.localLabel(failLabel);
    a.emit(0x31, 0xd2); // xor edx, edx
    a.emit(0xe8);
    a.emitRipRva(rvaReturnBool);
    a.emit(0x48, 0x83, 0xc4, 0x50);
    a.emit(0x5b);
    a.emit(0xc3);
}

// JS Function 3: acceptP2PSession(steamIdBuf8)
emitOneIdSteamCall("js_acceptP2PSession", DATA_PTR_NET, 6, false);
// JS Function 4: closeP2PSession(steamIdBuf8)
emitOneIdSteamCall("js_closeP2PSession", DATA_PTR_NET, 7, false);
// JS Function 5: requestFriendRichPresence(steamIdBuf8)
emitOneIdSteamCall("js_requestFriendRichPresence", DATA_PTR_FRIENDS, 8, true);
// JS Function 6: requestLobbyData(lobbyIdBuf8)
emitOneIdSteamCall("js_requestLobbyData", DATA_PTR_MM, 9, false);

// ---- JS Function 7: js_sendLobbyChatMsg(env, info) ----
// Args: (lobbyIdBuf8, dataBuf) -> SteamAPI_ISteamMatchmaking_SendLobbyChatMsg(pMM, lobbyId, dataPtr, dataLen)
a.label("js_sendLobbyChatMsg");
a.emit(0x53); // push rbx
a.emit(0x56); // push rsi
a.emit(0x48, 0x83, 0xec, 0x68); // sub rsp, 0x68
a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx

a.movRaxMemRip(DATA_PTR_MM);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("chat_send_fail");

a.emit(0x48, 0xc7, 0x44, 0x24, 0x30, 0x02, 0x00, 0x00, 0x00);
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x30);
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x38);
a.emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x00, 0x00, 0x00, 0x00);
a.callMemRip(DATA_NAPI_BASE + 2 * 8);

// argv[0] -> lobbyId
a.emit(0x48, 0xc7, 0x44, 0x24, 0x48, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9);
a.emit(0x48, 0x8b, 0x54, 0x24, 0x38);
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x48);
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x50);
a.callMemRip(DATA_NAPI_BASE + 3 * 8);
a.emit(0x48, 0x8b, 0x44, 0x24, 0x48);
a.emit(0x48, 0x85, 0xc0);
a.jzLabel("chat_send_fail");
a.emit(0x48, 0x8b, 0x30); // mov rsi, [rax] (lobbyId)

// argv[1] -> dataPtr, dataLen
a.emit(0x48, 0xc7, 0x44, 0x24, 0x48, 0x00, 0x00, 0x00, 0x00);
a.emit(0x48, 0x89, 0xd9);
a.emit(0x48, 0x8b, 0x54, 0x24, 0x40);
a.emit(0x4c, 0x8d, 0x44, 0x24, 0x48);
a.emit(0x4c, 0x8d, 0x4c, 0x24, 0x50);
a.callMemRip(DATA_NAPI_BASE + 3 * 8);

a.movRcxMemRip(DATA_PTR_MM);
a.emit(0x48, 0x89, 0xf2); // mov rdx, rsi (lobbyId)
a.emit(0x4c, 0x8b, 0x44, 0x24, 0x48); // mov r8, [rsp+0x48] (dataPtr)
a.emit(0x44, 0x8b, 0x4c, 0x24, 0x50); // mov r9d, [rsp+0x50] (dataLen)
a.callMemRip(DATA_STEAM_BASE + 10 * 8);
a.emit(0x0f, 0xb6, 0xd0);
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x83, 0xc4, 0x68);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

a.localLabel("chat_send_fail");
a.emit(0x31, 0xd2);
a.emit(0xe8);
a.emitRipRva(rvaReturnBool);
a.emit(0x48, 0x83, 0xc4, 0x68);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

// ---- JS Function 8: js_getLobbyChatEntry(env, info) -> null (placeholder) ----
a.label("js_getLobbyChatEntry");
a.emit(0x53);
a.emit(0x48, 0x83, 0xec, 0x20);
a.emit(0x48, 0x89, 0xcb);
a.emit(0xe8);
a.emitRipRva(a.labels.get("js_return_null"));
a.emit(0x48, 0x83, 0xc4, 0x20);
a.emit(0x5b);
a.emit(0xc3);

// ---- Exported Entrypoint: napi_register_module_v1(env /*rcx*/, exports /*rdx*/) -> exports ----
const rvaNapiRegister = a.label("napi_register_module_v1");
a.emit(0x53); // push rbx
a.emit(0x56); // push rsi
a.emit(0x57); // push rdi
a.emit(0x48, 0x83, 0xec, 0x40); // sub rsp, 0x40
a.emit(0x48, 0x89, 0xcb); // mov rbx, rcx (env)
a.emit(0x48, 0x89, 0xd6); // mov rsi, rdx (exports)

// hExe = GetModuleHandleA(NULL)
a.emit(0x31, 0xc9); // xor ecx, ecx
a.callMemRip(rvaIAT_GetModuleHandleA);
a.emit(0x48, 0x89, 0xc7); // mov rdi, rax (hExe)

// Resolve all NAPI_FUNCS
for (let i = 0; i < NAPI_FUNCS.length; i++) {
    a.emit(0x48, 0x89, 0xf9); // mov rcx, rdi
    a.leaRdxRip(rvaNapiNames[i]);
    a.callMemRip(rvaIAT_GetProcAddress);
    a.movMemRipRax(DATA_NAPI_BASE + i * 8);
}

// Register each JS function on exports:
// napi_create_function(env /*rcx*/, name /*rdx*/, NAPI_AUTO_LENGTH=-1 /*r8*/, cb /*r9*/, NULL /*[rsp+0x20]*/, &fnVal [rsp+0x30] /*[rsp+0x28]*/)
// napi_set_named_property(env /*rcx*/, exports /*rdx*/, name /*r8*/, fnVal /*r9*/)
const JS_LABELS = [
    "js_init",
    "js_sendP2PPacket",
    "js_readP2PPacket",
    "js_acceptP2PSession",
    "js_closeP2PSession",
    "js_requestFriendRichPresence",
    "js_requestLobbyData",
    "js_sendLobbyChatMsg",
    "js_getLobbyChatEntry",
];

for (let i = 0; i < JS_EXPORTS.length; i++) {
    a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx (env)
    a.leaRdxRip(rvaJsExportNames[i]); // rdx = name
    a.emit(0x49, 0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff); // mov r8, -1
    a.leaR9RipLabel(JS_LABELS[i]); // lea r9, [cb]
    a.emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00); // [rsp+0x20] = NULL
    a.emit(0x48, 0x8d, 0x44, 0x24, 0x30); // lea rax, [rsp+0x30]
    a.emit(0x48, 0x89, 0x44, 0x24, 0x28); // [rsp+0x28] = &fnVal
    a.callMemRip(DATA_NAPI_BASE + 0 * 8); // call napi_create_function

    a.emit(0x48, 0x89, 0xd9); // mov rcx, rbx (env)
    a.emit(0x48, 0x89, 0xf2); // mov rdx, rsi (exports)
    a.leaRcxRip(rvaJsExportNames[i]); // wait: we need lea r8, [rip + name]!
    // Replace previous 7 bytes with lea r8, [rip + disp32] (4C 8D 05 disp32)
    a.bytes.splice(a.bytes.length - 7, 7);
    a.emit(0x4c, 0x8d, 0x05);
    a.emitRipRva(rvaJsExportNames[i]);
    a.emit(0x4c, 0x8b, 0x4c, 0x24, 0x30); // mov r9, [rsp+0x30] (fnVal)
    a.callMemRip(DATA_NAPI_BASE + 1 * 8); // call napi_set_named_property
}

a.emit(0x48, 0x89, 0xf0); // mov rax, rsi (return exports)
a.emit(0x48, 0x83, 0xc4, 0x40);
a.emit(0x5f);
a.emit(0x5e);
a.emit(0x5b);
a.emit(0xc3);

const textBytes = a.finalize();
if (textBytes.length > SIZE_TEXT) {
    throw new Error(`Text section overflow: ${textBytes.length} > ${SIZE_TEXT}`);
}
textBytes.copy(buf, OFF_TEXT);

// ============================================================================
// 4. Build Export Directory Table in .rdata for napi_register_module_v1
// ============================================================================

const rvaDllName = allocCString("steam_p2p_win64.node");
const rvaExportSymName = allocCString("napi_register_module_v1");

const eatBuf = Buffer.alloc(4);
eatBuf.writeUInt32LE(rvaNapiRegister, 0);
const rvaEAT = allocRdata(eatBuf, 4);

const enptBuf = Buffer.alloc(4);
enptBuf.writeUInt32LE(rvaExportSymName, 0);
const rvaENPT = allocRdata(enptBuf, 4);

const eotBuf = Buffer.alloc(2);
eotBuf.writeUInt16LE(0, 0);
const rvaEOT = allocRdata(eotBuf, 2);

const edtBuf = Buffer.alloc(40, 0);
edtBuf.writeUInt32LE(0, 0); // Characteristics
edtBuf.writeUInt32LE(0, 4); // TimeDateStamp
edtBuf.writeUInt16LE(0, 8); // MajorVersion
edtBuf.writeUInt16LE(0, 10); // MinorVersion
edtBuf.writeUInt32LE(rvaDllName, 12); // Name RVA
edtBuf.writeUInt32LE(1, 16); // OrdinalBase
edtBuf.writeUInt32LE(1, 20); // AddressTableEntries
edtBuf.writeUInt32LE(1, 24); // NumberOfNamePointers
edtBuf.writeUInt32LE(rvaEAT, 28); // ExportAddressTableRVA
edtBuf.writeUInt32LE(rvaENPT, 32); // NamePointerRVA
edtBuf.writeUInt32LE(rvaEOT, 36); // OrdinalTableRVA
const rvaEDT = allocRdata(edtBuf, 4);

// ============================================================================
// 5. Build .reloc section (Empty 8-byte block at RVA 0x4000 so ASLR is happy)
// ============================================================================
buf.writeUInt32LE(RVA_TEXT, OFF_RELOC + 0); // PageRVA
buf.writeUInt32LE(8, OFF_RELOC + 4); // BlockSize (8 bytes = 0 entries)

// ============================================================================
// 6. Build DOS Header & PE64 Headers at File Offset 0
// ============================================================================

buf.write("MZ", 0, "ascii");
buf.writeUInt32LE(0x80, 0x3c); // e_lfanew = 0x80

const pe = 0x80;
buf.write("PE\0\0", pe, "ascii");
buf.writeUInt16LE(0x8664, pe + 4); // Machine = AMD64
buf.writeUInt16LE(4, pe + 6); // NumberOfSections = 4
buf.writeUInt32LE(0, pe + 8); // TimeDateStamp
buf.writeUInt32LE(0, pe + 12); // PointerToSymbolTable
buf.writeUInt32LE(0, pe + 16); // NumberOfSymbols
buf.writeUInt16LE(0xf0, pe + 20); // SizeOfOptionalHeader = 240 (PE32+)
buf.writeUInt16LE(0x2022, pe + 22); // Characteristics = EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE | DLL

const opt = pe + 24;
buf.writeUInt16LE(0x020b, opt + 0); // Magic = PE32+ (64-bit)
buf.writeUInt8(14, opt + 2); // MajorLinkerVersion
buf.writeUInt8(0, opt + 3); // MinorLinkerVersion
buf.writeUInt32LE(SIZE_TEXT, opt + 4); // SizeOfCode
buf.writeUInt32LE(SIZE_RDATA + SIZE_DATA + SIZE_RELOC, opt + 8); // SizeOfInitializedData
buf.writeUInt32LE(0, opt + 12); // SizeOfUninitializedData
buf.writeUInt32LE(rvaDllMain, opt + 16); // AddressOfEntryPoint
buf.writeUInt32LE(RVA_TEXT, opt + 20); // BaseOfCode
buf.writeBigUInt64LE(0x0000000180000000n, opt + 24); // ImageBase
buf.writeUInt32LE(SECT_ALIGN, opt + 32); // SectionAlignment
buf.writeUInt32LE(FILE_ALIGN, opt + 36); // FileAlignment
buf.writeUInt16LE(6, opt + 40); // MajorOperatingSystemVersion
buf.writeUInt16LE(0, opt + 42); // MinorOperatingSystemVersion
buf.writeUInt16LE(0, opt + 44); // MajorImageVersion
buf.writeUInt16LE(0, opt + 46); // MinorImageVersion
buf.writeUInt16LE(6, opt + 48); // MajorSubsystemVersion
buf.writeUInt16LE(0, opt + 50); // MinorSubsystemVersion
buf.writeUInt32LE(0, opt + 52); // Win32VersionValue
buf.writeUInt32LE(0x5000, opt + 56); // SizeOfImage
buf.writeUInt32LE(OFF_TEXT, opt + 60); // SizeOfHeaders
buf.writeUInt32LE(0, opt + 64); // CheckSum
buf.writeUInt16LE(3, opt + 68); // Subsystem = WINDOWS_CUI
buf.writeUInt16LE(0x0160, opt + 70); // DllCharacteristics = HIGH_ENTROPY_VA | DYNAMIC_BASE | NX_COMPAT
buf.writeBigUInt64LE(0x100000n, opt + 72); // SizeOfStackReserve
buf.writeBigUInt64LE(0x1000n, opt + 80); // SizeOfStackCommit
buf.writeBigUInt64LE(0x100000n, opt + 88); // SizeOfHeapReserve
buf.writeBigUInt64LE(0x1000n, opt + 96); // SizeOfHeapCommit
buf.writeUInt32LE(0, opt + 104); // LoaderFlags
buf.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes

// Data Directories (start at opt + 112)
const dd = opt + 112;
// 0: Export Table
buf.writeUInt32LE(rvaEDT, dd + 0);
buf.writeUInt32LE(40, dd + 4);
// 1: Import Table
buf.writeUInt32LE(rvaIDT, dd + 8);
buf.writeUInt32LE(40, dd + 12);
// 5: Base Relocation Table
buf.writeUInt32LE(RVA_RELOC, dd + 40);
buf.writeUInt32LE(8, dd + 44);
// 12: IAT
buf.writeUInt32LE(rvaIAT, dd + 96);
buf.writeUInt32LE(24, dd + 100);

// Section Headers (start at opt + 240)
const sh = opt + 240;
function writeSection(idx, name, vsize, rva, rawSize, rawOff, chars) {
    const off = sh + idx * 40;
    buf.write(name, off, "ascii");
    buf.writeUInt32LE(vsize, off + 8);
    buf.writeUInt32LE(rva, off + 12);
    buf.writeUInt32LE(rawSize, off + 16);
    buf.writeUInt32LE(rawOff, off + 20);
    buf.writeUInt32LE(chars, off + 36);
}
writeSection(0, ".text\0\0\0", textBytes.length, RVA_TEXT, SIZE_TEXT, OFF_TEXT, 0x60000020);
writeSection(1, ".rdata\0\0", rdataCursor, RVA_RDATA, SIZE_RDATA, OFF_RDATA, 0x40000040);
writeSection(2, ".data\0\0\0", SIZE_DATA, RVA_DATA, SIZE_DATA, OFF_DATA, 0xc0000040);
writeSection(3, ".reloc\0\0", 8, RVA_RELOC, SIZE_RELOC, OFF_RELOC, 0x42000040);

const outPath = path.resolve(__dirname, "..", "src", "steam_p2p_win64.node");
fs.writeFileSync(outPath, buf);
console.log(`Built ${outPath} (${buf.length} bytes, .text=${textBytes.length} bytes)`);
