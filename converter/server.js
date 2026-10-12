/*
 * .hwpx → PDF 변환 서버 (외부 패키지 없음)
 *
 *   GET  /health   → { ok: true }
 *   POST /convert  → 본문: .hwpx 파일 그대로 / 응답: PDF
 *
 * 받은 파일은 임시 폴더에서 변환하고, 응답을 보낸 뒤 바로 지운다.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PORT = +(process.env.PORT || 8080);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*"; // 배포할 때는 홈페이지 주소로 좁힌다
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 90 * 1000;
// 변환 엔진: hangul = 이 PC의 한글 프로그램(Windows, 원본과 같은 모양)
//            libreoffice = LibreOffice + H2Orestart (Docker 이미지)
const ENGINE = process.env.ENGINE || (process.platform === "win32" ? "hangul" : "libreoffice");
const SOFFICE = process.env.SOFFICE || "soffice";
// LibreOffice 사용자 프로필은 하나만 쓰고, 변환은 한 번에 하나씩 한다 (프로필 잠금 충돌 방지)
const PROFILE = "file://" + path.join(os.tmpdir(), "lo-profile");

let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function run(cmd, args, pdf, missingMsg) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("변환 시간이 너무 오래 걸려요.")); }, TIMEOUT_MS);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error(missingMsg) : e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(pdf)) resolve(pdf);
      else {
        console.error(log.trim().slice(-300));
        reject(new Error("변환하지 못했어요."));
      }
    });
  });
}

function convert(inputPath, outDir) {
  const pdf = path.join(outDir, path.basename(inputPath).replace(/\.[^.]+$/, ".pdf"));
  if (ENGINE === "hangul") {
    return run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(__dirname, "hwp2pdf.ps1"), "-InPath", inputPath, "-OutPath", pdf,
    ], pdf, "PowerShell을 찾을 수 없어요.");
  }
  return run(SOFFICE, [
    `-env:UserInstallation=${PROFILE}`,
    "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck",
    "--convert-to", "pdf", "--outdir", outDir, inputPath,
  ], pdf, "변환 프로그램(LibreOffice)을 찾을 수 없어요.");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, engine: ENGINE });
  if (req.method !== "POST" || req.url !== "/convert") return send(res, 404, { error: "없는 주소예요." });

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) { send(res, 413, { error: "파일이 너무 커요 (20MB까지)." }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    // .hwpx 는 zip 파일: "PK" 로 시작
    if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) return send(res, 400, { error: ".hwpx 파일만 변환할 수 있어요." });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-"));
    try {
      const input = path.join(dir, "document.hwpx");
      fs.writeFileSync(input, body);
      const pdfPath = await enqueue(() => convert(input, dir));
      send(res, 200, fs.readFileSync(pdfPath), "application/pdf");
    } catch (e) {
      console.error(e.message);
      send(res, 500, { error: e.message });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}).listen(PORT, () => console.log(`PDF 변환 서버 (${ENGINE}): http://localhost:${PORT}`));
