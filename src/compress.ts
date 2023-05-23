import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

const readAllFileName = async (dirPath: string, files: string[] = []): Promise<string[]> => {
  for (const dirent of await fs.promises.readdir(dirPath, { withFileTypes: true })) {
    const filePath = path.resolve(dirPath, dirent.name).replace(/\\/g, "/");
    if (dirent.isFile()) {
      files.push(filePath);
    } else if (dirent.isDirectory()) {
      await readAllFileName(filePath, files);
    }
  }
  return files;
};
/** 数字储存，跟MySQL类似的 */
const writeIntLenenc = (number: number) => {
  const buffer = Buffer.allocUnsafe(9);
  if (number <= 250) {
    buffer.writeUInt8(number);
    return buffer.subarray(0, 1);
  }
  if (number <= 0xffff) {
    buffer.writeUInt8(251);
    buffer.writeUInt16BE(number, 1);
    return buffer.subarray(0, 3);
  }
  if (number <= 0xffffff) {
    buffer.writeUInt8(252);
    buffer.writeUIntBE(number, 1, 3);
    return buffer.subarray(0, 4);
  }
  if (number <= 0xffffffff) {
    buffer.writeUInt8(253);
    buffer.writeUInt32BE(number, 1);
    return buffer.subarray(0, 5);
  }
  if (number <= 0xffffffffff) {
    buffer.writeUInt8(254);
    buffer.writeUIntBE(number, 1, 6);
    return buffer.subarray(0, 7);
  }
  buffer.writeUInt8(255);
  buffer.writeBigUInt64BE(BigInt(number), 1);
  return buffer;
};

const getLengthBuffer = async (fileNames: string[], fileNameIndexBufferLength: number) => {
  const lengthBuffers: Buffer[] = [];

  for (const fileName of fileNames) {
    const { size } = await fs.promises.stat(fileName);
    lengthBuffers.push(writeIntLenenc(size));
  }
  /** 写入fileNameIndexBuffer */
  lengthBuffers.unshift(writeIntLenenc(fileNameIndexBufferLength));
  console.log(fileNameIndexBufferLength);

  /** 写入整个头部的长度 */
  lengthBuffers.unshift(writeIntLenenc(lengthBuffers.reduce((total, buf) => buf.length + total, 0)));

  return Buffer.concat(lengthBuffers);
};

const compress = (dirPath: string) => {
  // const brotliCompress = zlib.createDeflateRaw();
  const brotliCompress = zlib.createBrotliCompress();
  (async () => {
    dirPath = path.resolve(dirPath).replace(/\\/g, "/");
    const fileNames = await readAllFileName(dirPath);
    fileNames.sort();
    const fileNameIndexBuffer = Buffer.from(
      fileNames.map(fileName => `/${fileName.substring(dirPath.length)}`.replace(/\/+/g, "/").substring(1)).join("\0")
    );

    const lengthBuffer = await getLengthBuffer(fileNames, fileNameIndexBuffer.length);

    brotliCompress.write(lengthBuffer);
    brotliCompress.write(fileNameIndexBuffer);

    for (const fileName of fileNames) {
      console.log(fileName);
      const f = fs.createReadStream(fileName);
      f.pipe(brotliCompress, { end: false });
      await new Promise(r => brotliCompress.once("unpipe", r));
    }
    brotliCompress.end();
    console.log("完成");
  })();
  return brotliCompress;
};

compress("./").pipe(fs.createWriteStream("1.bin"));
setTimeout(() => {
  fs.writeFileSync("1.un", zlib.brotliDecompressSync(fs.readFileSync("1.bin")));
}, 1000);
