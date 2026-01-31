#!/usr/bin/env npx tsx
/**
 * Interactive Setup Wizard for PFT CLI Client
 * 
 * Guides users (human or AI agent) through:
 * 1. Building the CLI (npm install + build)
 * 2. JWT token configuration
 * 3. Wallet mnemonic configuration
 * 4. Verification that everything works
 */

import * as readline from "node:readline";
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".pft-tasknode");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ANSI colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(msg: string) {
  console.log(msg);
}

function logStep(step: number, total: number, msg: string) {
  log(`\n${colors.blue}[${step}/${total}]${colors.reset} ${colors.bright}${msg}${colors.reset}`);
}

function logSuccess(msg: string) {
  log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logWarning(msg: string) {
  log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logError(msg: string) {
  log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(msg: string) {
  log(`${colors.dim}${msg}${colors.reset}`);
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await prompt(rl, `${question} ${hint}: `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

function loadConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Ignore permission errors on Windows
  }
}

function checkBuildStatus(): { installed: boolean; built: boolean } {
  const nodeModulesExists = fs.existsSync(path.join(process.cwd(), "node_modules"));
  const distExists = fs.existsSync(path.join(process.cwd(), "dist"));
  return { installed: nodeModulesExists, built: distExists };
}

function runCommand(cmd: string, description: string): boolean {
  log(`\n${colors.dim}$ ${cmd}${colors.reset}`);
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch (error) {
    logError(`Failed: ${description}`);
    return false;
  }
}

async function runAuthStatus(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["pft-cli", "auth:status"], {
      shell: true,
      env: process.env,
    });
    
    let output = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      output += data.toString();
    });
    
    child.on("close", (code) => {
      resolve({ success: code === 0, output });
    });
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  log(`\n${colors.bright}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bright}║       PFT CLI Client - Interactive Setup Wizard        ║${colors.reset}`);
  log(`${colors.bright}╚════════════════════════════════════════════════════════╝${colors.reset}`);
  
  log(`\nThis wizard will help you set up the PFT CLI for interacting with`);
  log(`the Post Fiat Task Node (https://tasknode.postfiat.org).`);
  
  const totalSteps = 4;

  // Step 1: Check/run build
  logStep(1, totalSteps, "Check build status");
  
  const buildStatus = checkBuildStatus();
  
  if (!buildStatus.installed) {
    logWarning("node_modules not found. Running npm install...");
    if (!runCommand("npm install", "npm install")) {
      logError("Setup failed at npm install. Please run manually and retry.");
      rl.close();
      process.exit(1);
    }
    logSuccess("Dependencies installed");
  } else {
    logSuccess("Dependencies already installed");
  }
  
  if (!buildStatus.built) {
    logWarning("dist/ not found. Running npm run build...");
    if (!runCommand("npm run build", "npm run build")) {
      logError("Setup failed at build. Please check for TypeScript errors.");
      rl.close();
      process.exit(1);
    }
    logSuccess("Build complete");
  } else {
    logSuccess("Already built");
  }

  // Step 2: JWT Token
  logStep(2, totalSteps, "Configure JWT Token");
  
  const existingConfig = loadConfig();
  const hasExistingJwt = !!existingConfig.jwt || !!process.env.PFT_TASKNODE_JWT;
  
  if (hasExistingJwt) {
    logInfo("Existing JWT found.");
    const reconfigure = await promptYesNo(rl, "Do you want to update the JWT token?", false);
    if (!reconfigure) {
      logSuccess("Keeping existing JWT");
    } else {
      await configureJwt(rl, existingConfig);
    }
  } else {
    log(`\n${colors.cyan}To get your JWT token:${colors.reset}`);
    log(`  1. Open ${colors.bright}https://tasknode.postfiat.org${colors.reset} in your browser`);
    log(`  2. Log in with your Post Fiat account`);
    log(`  3. Open DevTools (F12) → Network tab`);
    log(`  4. Click any action to trigger an API request`);
    log(`  5. Find a request to tasknode.postfiat.org`);
    log(`  6. Copy the Authorization header value (after "Bearer ")`);
    log(`\n${colors.dim}The JWT is a long string starting with "eyJ..."${colors.reset}`);
    
    await configureJwt(rl, existingConfig);
  }

  // Step 3: Wallet Mnemonic
  logStep(3, totalSteps, "Configure Wallet Mnemonic");
  
  const hasMnemonic = !!process.env.PFT_WALLET_MNEMONIC || !!process.env.PFT_WALLET_SEED;
  
  if (hasMnemonic) {
    logSuccess("Wallet credentials found in environment");
    logInfo("Mnemonic is set via PFT_WALLET_MNEMONIC or PFT_WALLET_SEED");
  } else {
    log(`\n${colors.cyan}To get your wallet mnemonic:${colors.reset}`);
    log(`  1. Open the Post Fiat mobile app`);
    log(`  2. Go to Settings → Export Seed`);
    log(`  3. Copy the 24-word recovery phrase`);
    log(`\n${colors.yellow}Security note:${colors.reset} The mnemonic is sensitive. We recommend`);
    log(`setting it as an environment variable rather than saving to config:`);
    log(`\n  ${colors.dim}export PFT_WALLET_MNEMONIC="word1 word2 ... word24"${colors.reset}`);
    
    const configureMnemonic = await promptYesNo(rl, "\nDo you want to set the mnemonic now?", false);
    
    if (configureMnemonic) {
      log(`\n${colors.yellow}Warning:${colors.reset} Entering mnemonic here will display it in the terminal.`);
      log(`For security, consider setting PFT_WALLET_MNEMONIC in your shell profile instead.`);
      
      const proceed = await promptYesNo(rl, "Proceed anyway?", false);
      if (proceed) {
        const mnemonic = await prompt(rl, "\nEnter your 24-word mnemonic: ");
        if (mnemonic && mnemonic.split(/\s+/).length >= 12) {
          // Set for current session
          process.env.PFT_WALLET_MNEMONIC = mnemonic;
          logSuccess("Mnemonic set for this session");
          log(`\n${colors.dim}To persist, add to your shell profile:${colors.reset}`);
          log(`  export PFT_WALLET_MNEMONIC="${mnemonic.substring(0, 20)}..."`);
        } else {
          logWarning("Invalid mnemonic format. Skipping.");
        }
      } else {
        logInfo("Skipped mnemonic configuration");
      }
    } else {
      logInfo("Skipped mnemonic configuration");
      log(`\n${colors.dim}You can set it later with:${colors.reset}`);
      log(`  export PFT_WALLET_MNEMONIC="word1 word2 ... word24"`);
    }
  }

  // Step 4: Verify
  logStep(4, totalSteps, "Verify Configuration");
  
  log("\nRunning auth:status to verify setup...\n");
  
  const authResult = await runAuthStatus();
  
  if (authResult.success) {
    try {
      const parsed = JSON.parse(authResult.output);
      logSuccess("Authentication successful!");
      log(`\n${colors.cyan}Account Summary:${colors.reset}`);
      log(`  Address: ${parsed.address || "N/A"}`);
      log(`  PFT Balance: ${parsed.pft_balance || "N/A"}`);
      log(`  Tasks Outstanding: ${parsed.task_counts?.outstanding ?? "N/A"}`);
      log(`  Tasks Rewarded: ${parsed.task_counts?.rewarded ?? "N/A"}`);
    } catch {
      logSuccess("Authentication successful!");
      log(authResult.output);
    }
  } else {
    logError("Authentication failed");
    log(authResult.output);
    log(`\n${colors.yellow}Troubleshooting:${colors.reset}`);
    log(`  - JWT may be expired (they last ~24 hours)`);
    log(`  - Get a fresh token from https://tasknode.postfiat.org`);
    log(`  - Run: npx pft-cli auth:set-token "<new-jwt>"`);
  }

  // Summary
  log(`\n${colors.bright}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bright}║                    Setup Complete                       ║${colors.reset}`);
  log(`${colors.bright}╚════════════════════════════════════════════════════════╝${colors.reset}`);
  
  log(`\n${colors.cyan}Quick Start Commands:${colors.reset}`);
  log(`  ${colors.dim}# Check your tasks${colors.reset}`);
  log(`  npx pft-cli tasks:summary`);
  log(`\n  ${colors.dim}# List outstanding tasks${colors.reset}`);
  log(`  npx pft-cli tasks:list --status outstanding`);
  log(`\n  ${colors.dim}# Request a new task${colors.reset}`);
  log(`  npx pft-cli chat:send --content "request a personal task: [description]" --context "..." --wait`);
  log(`\n  ${colors.dim}# Run full E2E test (5-6 minutes)${colors.reset}`);
  log(`  npx pft-cli loop:test --type personal`);
  
  log(`\n${colors.dim}See CLAUDE.md or README.md for full documentation.${colors.reset}\n`);

  rl.close();
}

async function configureJwt(rl: readline.Interface, config: Record<string, unknown>) {
  const jwt = await prompt(rl, "\nPaste your JWT token: ");
  
  if (!jwt) {
    logWarning("No JWT provided. Skipping.");
    return;
  }
  
  if (!jwt.startsWith("eyJ")) {
    logWarning("JWT doesn't look valid (should start with 'eyJ'). Saving anyway.");
  }
  
  // Save to config file
  config.jwt = jwt;
  saveConfig(config);
  logSuccess(`JWT saved to ${CONFIG_PATH}`);
  
  // Also set for current session
  process.env.PFT_TASKNODE_JWT = jwt;
}

main().catch((error) => {
  logError(`Setup failed: ${error.message}`);
  process.exit(1);
});
