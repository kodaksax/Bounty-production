#!/bin/bash

# BountyExpo Development Environment Setup Script
# This script sets up the complete development environment for new contributors

set -e

echo "🚀 Setting up BountyExpo development environment..."
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi
echo "✅ Node.js $(node -v) detected"

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
fi
echo "✅ pnpm $(pnpm -v) detected"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi
echo "✅ Docker $(docker --version | cut -d ' ' -f 3 | cut -d ',' -f 1) detected"

# Check for Docker Compose
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please ensure Docker Desktop is installed and running"
    exit 1
fi
echo "✅ Docker Compose detected"

# Setup environment file
echo ""
echo "🔧 Setting up environment configuration..."
if [ ! -f .env ]; then
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env file and add your API keys and configuration"
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install

# Verify workspaces
echo ""
echo "🔍 Verifying workspace configuration..."
pnpm list --depth=0 --workspaces

# Build API service
echo ""
echo "🏗️  Building API service..."
cd services/api
pnpm run build
cd ../..

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "🎯 Next steps:"
echo "  1. Edit .env file with your configuration"
echo "  2. Run 'pnpm dev' to start all services"
echo "  3. Run 'pnpm start' to start the Expo development server"
echo ""
echo "📚 Documentation:"
echo "  - README.md for complete setup guide"
echo "  - .env.example for configuration reference"
echo ""
echo "🐛 Troubleshooting:"
echo "  - Run 'pnpm dev:logs' to view service logs"
echo "  - Run 'pnpm dev:stop' to stop all services"
echo "  - Check Docker containers: 'docker ps'"