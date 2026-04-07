## 3. Technology Stack

### 3.1 Runtime & Language

All backend code is written in **TypeScript** running on **Node.js >= 20**. TypeScript is used everywhere — no plain JavaScript files. The frontend is also TypeScript with React.

### 3.2 Backend Dependencies

```json
{
  "dependencies": {
    "express": "^4.18",
    "better-sqlite3": "^11.0",
    "octokit": "^4.0",
    "azure-devops-node-api": "^14.0",
    "node-cron": "^3.0",
    "winston": "^3.11",
    "zod": "^3.22",
    "dotenv": "^16.3",
    "cors": "^2.8",
    "uuid": "^9.0"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "@types/node": "^20",
    "@types/express": "^4",
    "@types/better-sqlite3": "^7",
    "tsx": "^4.7",
    "vitest": "^1.3"
  }
}
```

### 3.3 Frontend Dependencies

```json
{
  "dependencies": {
    "react": "^18.2",
    "react-dom": "^18.2",
    "react-router-dom": "^6.22",
    "axios": "^1.6",
    "@tanstack/react-query": "^5.20",
    "tailwindcss": "^3.4",
    "lucide-react": "^0.344",
    "react-syntax-highlighter": "^15.5",
    "date-fns": "^3.3"
  }
}
```

### 3.4 External Tool Requirement

**Claude CLI must be installed and authenticated** on the machine running this application. The system expects the `claude` command to be available in the system PATH. Claude CLI handles its own API key management — the application does not store or manage Anthropic API keys.

Verify installation:
```bash
claude --version    # Must return a valid version
claude --help       # Confirm non-interactive flags are available
```

---
