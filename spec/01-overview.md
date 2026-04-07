## 1. Project Overview

### 1.1 Problem Statement

Manual code reviews are time-consuming and inconsistent. Teams need a system that automatically reviews every pull request using AI, tracks reviews by PR number and commit ID, and presents results through a web interface.

### 1.2 System Summary

This application continuously polls one or more repositories — on **GitHub** and/or **Azure DevOps** — for open pull requests. When it detects a new PR or a new commit on an existing PR, it clones or updates the repository locally, checks out the relevant branch, and invokes **Claude CLI (`claude`)** in non-interactive mode to perform a structured code review. The review output is parsed, stored in a SQLite database, and served to a React-based frontend where developers can search, filter, and read reviews by PR number or commit SHA. Both providers are supported through a unified `GitProvider` interface, so the rest of the system — the reviewer, the database, the API, and the frontend — is completely provider-agnostic.

### 1.3 Why Claude CLI Instead of the API

Claude CLI (Claude Code) is the review engine because it can do things a raw API call cannot. When you point Claude CLI at a local checkout of the repo, it can read the full project structure, understand imports and dependencies across files, follow function definitions, and use its built-in tools (file reading, grep, glob) to build context before writing its review. This produces dramatically better reviews than sending an isolated diff to an API endpoint. The CLI also handles its own authentication, retry logic, and model selection, which simplifies the backend.

---
