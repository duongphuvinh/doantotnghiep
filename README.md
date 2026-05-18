# AI Chat Application with MCP (Model Context Protocol)

A full-stack chat application integrating AI models and the Model Context Protocol for enhanced context management.

## Project Structure

```
├── Chat/              # Next.js frontend application
├── mcp-server/        # MCP server + FastAPI medical backend
├── postgres/          # PostgreSQL database with pgvector
└── tool/              # Utility tools and helpers
```

## Prerequisites

- Node.js 18+ and npm/yarn
- Docker and Docker Compose
- PostgreSQL 16+ (or use Docker)

## Quick Start

### 1. Start Database

```bash
cd postgres
docker-compose up -d
```

This will start:
- **PostgreSQL** on port 5432
  - User: `admin`
  - Password: `admin123`
  - Database: `mydb`
- **pgAdmin** on http://localhost:5050
  - Email: `admin@local.com`
  - Password: `admin123`

### 2. Set Up Environment Variables

Create `.env.local` in the `Chat` directory:

```bash
cd Chat
cp .env.example .env.local  # if available, otherwise create manually
```

Required environment variables for Chat:
```
# Database
DATABASE_URL=postgresql://admin:admin123@localhost:5432/mydb

# AI Model APIs (add your own keys)
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
```

### 3. Install Dependencies and Run

#### Chat Application (Port 3001)
```bash
cd Chat
npm install
npm run dev
```

#### MCP Server (Port 3000)
```bash
cd ../mcp-server
npm install
npm run dev
```

#### Medical FastAPI Backend (Port 8000)
```bash
cd ../mcp-server
.\scripts\setup_backend.ps1
.\.venv\Scripts\python.exe scripts\run_backend.py --reload
```

## Database Setup

Run database migrations in the Chat directory:

```bash
cd Chat
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
npm run db:push      # Push schema to database
```

For database studio (visual editor):
```bash
npm run db:studio
```

## Build for Production

### Chat
```bash
cd Chat
npm run build
npm start
```

### MCP Server
```bash
cd mcp-server
npm run build
npm start
```

## Available Scripts

### Chat Application
- `npm run dev` - Start development server (port 3001)
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate DB migrations
- `npm run db:migrate` - Run migrations
- `npm run db:push` - Push schema to DB
- `npm run db:studio` - Open database studio

### MCP Server
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run backend:dev` - Start FastAPI medical backend after Python deps are installed
- `npm run backend:test` - Run Python backend tests

## Technologies Used

### Frontend (Chat)
- Next.js 15.3
- React 19
- TypeScript
- Tailwind CSS
- Radix UI components
- TanStack React Query

### Backend (MCP Server)
- Next.js 16
- Model Context Protocol SDK
- Google Generative AI
- FastAPI medical image/lab backend
- Python image processing and lightweight model inference

### Database
- PostgreSQL 16
- pgvector (for vector embeddings)
- Drizzle ORM (Chat app)

### AI/ML Integration
- Anthropic API
- OpenAI API
- Google AI API
- Groq API
- XAI API

## Port Reference

| Service | Port | URL |
|---------|------|-----|
| Chat Application | 3001 | http://localhost:3001 |
| MCP Server | 3000 | http://localhost:3000 |
| Medical FastAPI Backend | 8000 | http://localhost:8000/docs |
| PostgreSQL | 5432 | localhost:5432 |
| pgAdmin | 5050 | http://localhost:5050 |

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running: `docker-compose ps` in postgres directory
- Check credentials in `.env.local`
- Verify DATABASE_URL format

### Port Already in Use
- Chat on 3001: `lsof -i :3001` and kill the process
- MCP Server on 3000: `lsof -i :3000` and kill the process

### Module Not Found Errors
- Clear node_modules: `rm -rf node_modules && npm install`
- Clear Next.js cache: `rm -rf .next`

## Development Tips

1. **Hot Reload**: Both Next.js apps support hot reload in development
2. **Database Changes**: After schema changes, run `npm run db:push` in Chat
3. **API Keys**: Keep `.env.local` out of version control (included in .gitignore)

## License

Proprietary - DATN (Đồ án tốt nghiệp)

## Contributing

Internal project - please follow the established code structure and conventions.
