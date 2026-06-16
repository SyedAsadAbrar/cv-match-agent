import path from "node:path";
import { PDFParse } from "pdf-parse";
import { readBinaryFile, readTextFile } from "../utils/file";

export async function readCvFile(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    return readPdfCv(filePath);
  }

  return readTextFile(filePath);
}

async function readPdfCv(filePath: string): Promise<string> {
  const data = await readBinaryFile(filePath);
  const parser = new PDFParse({ data });

  try {
    const parsed = await parser.getText();
    const text = parsed.text.trim();

    if (!text) {
      throw new Error(`Could not extract text from PDF CV "${filePath}". Try a text-based PDF or convert it to .txt/.md.`);
    }

    return text;
  } finally {
    await parser.destroy();
  }
}
