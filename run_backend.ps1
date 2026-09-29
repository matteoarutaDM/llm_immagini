# Avvia il backend FastAPI su Windows (PowerShell), senza WSL ne' Docker.
#
#   .\run_backend.ps1
#   .\run_backend.ps1 -OllamaBaseUrl http://100.x.x.x:11434 -OllamaModel llama3.1:8b
#
# Senza parametri valgono i valori di .env. I parametri valgono solo per questa sessione.
# Se PowerShell blocca lo script: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
param(
    [string]$OllamaBaseUrl,
    [string]$OllamaModel,
    [string]$ListenHost = "127.0.0.1",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Ambiente virtuale non trovato. Crealo con: py -3.12 -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

if ($OllamaBaseUrl) { $env:OLLAMA_BASE_URL = $OllamaBaseUrl }
if ($OllamaModel) { $env:OLLAMA_MODEL = $OllamaModel }

& $python -m uvicorn backend.main:app --host $ListenHost --port $Port
