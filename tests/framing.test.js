const { test, describe } = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("events");

function createFrameBuffer(obj) {
    const payload = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

function attachFrameParser(socket, onMessage) {
    let buffer = Buffer.alloc(0);
    socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const msgLen = buffer.readUInt32BE(0);
            if (msgLen > 64 * 1024 * 1024) {
                socket.destroy();
                return;
            }
            if (buffer.length < 4 + msgLen) {
                break;
            }
            const jsonSlice = buffer.subarray(4, 4 + msgLen).toString("utf8");
            buffer = buffer.subarray(4 + msgLen);
            try {
                const parsed = JSON.parse(jsonSlice);
                onMessage(parsed);
            } catch (err) {
                // Ignore parse errors in stream
            }
        }
    });
}

describe("TCP Framing and Streaming Protocol", () => {
    test("encodes JSON message with 4-byte big-endian prefix", () => {
        const msg = { type: "ping", ts: 12345 };
        const frame = createFrameBuffer(msg);

        assert.strictEqual(frame.length, 4 + Buffer.byteLength(JSON.stringify(msg)));
        const len = frame.readUInt32BE(0);
        assert.strictEqual(len, Buffer.byteLength(JSON.stringify(msg)));
    });

    test("decodes a single complete frame", (t, done) => {
        const emitter = new EventEmitter();
        const expected = { type: "player:join", name: "Alice", steamId: "123456" };

        attachFrameParser(emitter, parsed => {
            assert.deepStrictEqual(parsed, expected);
            done();
        });

        emitter.emit("data", createFrameBuffer(expected));
    });

    test("handles multiple concatenated frames in a single TCP chunk", () => {
        const emitter = new EventEmitter();
        const received = [];

        attachFrameParser(emitter, parsed => {
            received.push(parsed);
        });

        const frame1 = createFrameBuffer({ seq: 1, action: "place" });
        const frame2 = createFrameBuffer({ seq: 2, action: "delete" });
        const frame3 = createFrameBuffer({ seq: 3, action: "ping" });

        emitter.emit("data", Buffer.concat([frame1, frame2, frame3]));

        assert.strictEqual(received.length, 3);
        assert.strictEqual(received[0].seq, 1);
        assert.strictEqual(received[1].seq, 2);
        assert.strictEqual(received[2].seq, 3);
    });

    test("correctly reassembles frames split across arbitrary byte boundaries", () => {
        const emitter = new EventEmitter();
        const received = [];

        attachFrameParser(emitter, parsed => {
            received.push(parsed);
        });

        const msg = { longText: "A".repeat(5000), list: [1, 2, 3, 4, 5] };
        const fullBuffer = createFrameBuffer(msg);

        // Slice into 17-byte chunks to stress boundary reassembly
        const chunkSize = 17;
        for (let i = 0; i < fullBuffer.length; i += chunkSize) {
            emitter.emit("data", fullBuffer.subarray(i, i + chunkSize));
        }

        assert.strictEqual(received.length, 1);
        assert.deepStrictEqual(received[0], msg);
    });

    test("destroys socket if frame length exceeds maximum allowable guard size", () => {
        const emitter = new EventEmitter();
        let destroyed = false;
        emitter.destroy = () => {
            destroyed = true;
        };

        attachFrameParser(emitter, () => {});

        const malformedHeader = Buffer.alloc(4);
        malformedHeader.writeUInt32BE(70 * 1024 * 1024, 0); // 70MB > 64MB limit
        emitter.emit("data", malformedHeader);

        assert.strictEqual(destroyed, true);
    });
});
