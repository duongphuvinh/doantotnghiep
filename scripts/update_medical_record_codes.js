const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const workbookPath = path.resolve(__dirname, "..", "tool", "tblMedicalRecord_200rows.xlsx");
const backupPath = workbookPath.replace(/\.xlsx$/i, ".backup-before-code-update.xlsx");

function readZipEntries(buffer) {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Cannot find ZIP end of central directory");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function unzip(buffer) {
  const files = new Map();
  for (const entry of readZipEntries(buffer)) {
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const nameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    const data = entry.method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    files.set(entry.name, data);
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zip(files) {
  const now = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.dosTime, 10);
    local.writeUInt16LE(now.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.dosTime, 12);
    central.writeUInt16LE(now.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function getCell(rowXml, column) {
  const match = rowXml.match(new RegExp(`<c[^>]*r="${column}(\\d+)"[^>]*>[\\s\\S]*?<\\/c>`));
  return match ? match[0] : "";
}

function getCellValue(cellXml) {
  return cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
}

function inlineStringCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function updateSheet(sheetXml) {
  let updatedCount = 0;
  const updated = sheetXml.replace(/<row[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (rowXml, rowNumberText) => {
    const rowNumber = Number(rowNumberText);
    if (rowNumber <= 1) return rowXml;

    const id = getCellValue(getCell(rowXml, "A"));
    const idNumber = Number(id);
    if (!Number.isFinite(idNumber)) return rowXml;

    const code = `BN${String(idNumber).padStart(3, "0")}`;
    const cellRef = `C${rowNumber}`;
    const newCell = inlineStringCell(cellRef, code);
    updatedCount += 1;

    const existing = getCell(rowXml, "C");
    if (existing) return rowXml.replace(existing, newCell);

    const idCell = getCell(rowXml, "B") || getCell(rowXml, "A");
    return idCell ? rowXml.replace(idCell, `${idCell}${newCell}`) : rowXml;
  });
  return { updated, updatedCount };
}

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Workbook not found: ${workbookPath}`);
}

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(workbookPath, backupPath);
}

const files = unzip(fs.readFileSync(workbookPath));
const sheetName = "xl/worksheets/sheet1.xml";
const sheet = files.get(sheetName);
if (!sheet) throw new Error(`${sheetName} not found`);

const { updated, updatedCount } = updateSheet(sheet.toString("utf8"));
files.set(sheetName, Buffer.from(updated, "utf8"));
fs.writeFileSync(workbookPath, zip(files));

console.log(`Updated ${updatedCount} MaNguoiBenh cells`);
console.log(`Backup: ${backupPath}`);
