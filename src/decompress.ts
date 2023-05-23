import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as stream from "stream";

class SubReadStream extends stream.Readable {
  public sourceStream: stream.Readable;
  public needReadSize: number;
  private tempBuffer?: Buffer;
  public done: (subReadStream: SubReadStream) => void;
  constructor(sourceStream: stream.Readable, needReadSize: number, done?: (subReadStream: SubReadStream) => void) {
    super();
    this.sourceStream = sourceStream;
    this.needReadSize = needReadSize;
    this.done = done || (() => {});
    this.sourceStream.pause();
  }
  public _construct(callback: (err: TypeError | undefined) => void) {
    callback(this.sourceStream.destroyed ? new TypeError("stream destroyed") : undefined);
  }
  public consume() {
    while (this.tempBuffer && this.tempBuffer.length) {
      const nowRecvSize = Math.min(this.tempBuffer.length, this.needReadSize);
      this.push(this.tempBuffer.subarray(0, nowRecvSize));
      this.tempBuffer = nowRecvSize < this.tempBuffer.length ? this.tempBuffer.subarray(nowRecvSize) : undefined;
      this.needReadSize -= nowRecvSize;
      if (this.needReadSize <= 0) {
        this.sourceStream.unshift(this.tempBuffer);
        this.push(null);
        this.done(this);
        return true;
      }
    }

    return false;
  }
  public _read(canRecvSize: number) {
    if (this.consume()) {
      return;
    }
    if (!this.tempBuffer || !this.tempBuffer.length) {
      this.sourceStream.resume();
      this.sourceStream.once("data", chuck => {
        this.tempBuffer = chuck;
        this.sourceStream.pause();
        this.consume();
      });
    } else {
      throw new Error("不科学");
    }
  }
  public _destroy(err, callback) {
    callback(err);
  }
}

const recvAll = (stream: stream.Readable): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const body: Buffer[] = [];
    stream.on("data", chuck => body.push(chuck));
    stream.once("end", () => resolve(Buffer.concat(body)));
    stream.once("error", reject);
  });
let offset: number = 0;
const readIntLenenc = (buffer: Buffer) => {
  let number = buffer[offset];
  offset += 1;
  switch (number) {
    case 251:
      number = buffer.readUIntBE(offset, 2);
      offset += 2;
      break;
    case 252:
      number = buffer.readUIntBE(offset, 3);
      offset += 3;
      break;
    case 253:
      number = buffer.readUIntBE(offset, 4);
      offset += 4;
      break;
    case 254:
      number = buffer.readUIntBE(offset, 6);
      offset += 6;
      break;
    case 255:
      number = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
      break;
  }
  return number;
};
const decompress = (dirPath: string = __dirname, onend = () => {}) => {
  // const brotliCompress = zlib.createDeflateRaw();
  const brotliDecompress = zlib.createBrotliDecompress();

  (async () => {
    dirPath = path.resolve(dirPath).replace(/\\/g, "/");
    /** 整个头部的长度，先读9个字节 */
    const headLengthBuffer = await recvAll(new SubReadStream(brotliDecompress, 9));
    offset = 0;
    const headLength = readIntLenenc(headLengthBuffer);
    brotliDecompress.unshift(headLengthBuffer.subarray(offset));

    const headBuffer = await recvAll(new SubReadStream(brotliDecompress, headLength));

    /** 所有文件的大小 */
    const fileLength: number[] = [];
    offset = 0;
    while (offset < headBuffer.length) {
      fileLength.push(readIntLenenc(headBuffer));
    }
    console.log([...fileLength]);

    /** 取出所有文件名 */
    const fileNames = String(await recvAll(new SubReadStream(brotliDecompress, fileLength.shift() || 0)))
      /** 安全考虑 */
      .replace(/[\.]+\//g, "/")
      .split("\0")
      .map(fileName => path.resolve(dirPath, fileName));

    /** 创建文件夹 */
    const dirSet = new Set(fileNames.map(fileName => path.parse(fileName).dir));
    for (const dir of dirSet) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    for (const fileName of fileNames) {
      console.log(fileName);
      await new Promise(r =>
        new SubReadStream(brotliDecompress, fileLength.shift() || 0, r).pipe(fs.createWriteStream(fileName))
      );
    }
    onend();
  })();
  return brotliDecompress;
};

fs.createReadStream("1.bin").pipe(decompress("../../out"));

// setTimeout(() => {
//   fs.writeFileSync("1.un", zlib.brotliDecompressSync(fs.readFileSync("1.bin")));
// }, 1000);
