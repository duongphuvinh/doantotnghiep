# MCP Server + Medical Backend

Thu muc nay gom ca Next.js MCP server va backend FastAPI xu ly anh/phim xuong, xet nghiem, multimodal va danh gia model.

## Chay MCP/Next server

```bash
cd mcp-server
npm install
npm run dev
```

Mac dinh Next.js chay o:

```text
http://localhost:3000
```

## Chay backend y khoa

### Windows PowerShell

```powershell
cd mcp-server
.\scripts\setup_backend.ps1
.\.venv\Scripts\python.exe scripts\run_backend.py --reload
```

### macOS / Linux

```bash
cd mcp-server
chmod +x scripts/setup_backend.sh
./scripts/setup_backend.sh
./.venv/bin/python scripts/run_backend.py --reload
```

Backend API mac dinh chay o:

```text
http://localhost:8000/docs
```

Chi tiet rieng phan FastAPI/model nam trong [BACKEND_README.md](./BACKEND_README.md).
