const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
let router = express.Router()
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    async function PrabathPair() {
        // Make sure the session directory exists
        if (!fs.existsSync('./session')) {
            fs.mkdirSync('./session', { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            // Create a minimal logger that only logs fatal errors
            const logger = pino({ level: "fatal" }).child({ level: "fatal" });
            
            let PrabathPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: Browsers.macOS("Safari"),
                // Add additional options for latest version compatibility
                version: [2, 2413, 3], // Use a recent stable version
                connectTimeoutMs: 60000, // Extend connection timeout
                // Retry connection with exponential backoff
                retryRequestDelayMs: 2500,
            });

            if (!PrabathPairWeb.authState.creds.registered) {
                await delay(1500);
                
                // Format the phone number properly (remove any non-numeric characters)
                num = num.replace(/[^0-9]/g, '');
                
                try {
                    // Request the pairing code with explicit error handling
                    const code = await PrabathPairWeb.requestPairingCode(num);
                    
                    if (!res.headersSent) {
                        await res.send({ code });
                    }
                } catch (pairingError) {
                    console.log("Pairing code error:", pairingError);
                    if (!res.headersSent) {
                        await res.send({ code: "Error generating pairing code. Please try again." });
                    }
                }
            }

            // Handle credential updates
            PrabathPairWeb.ev.on('creds.update', saveCreds);
            
            // Handle connection updates
            PrabathPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                
                if (connection === "open") {
                    try {
                        // Wait to ensure all credentials are properly saved
                        await delay(10000);
                        
                        // Check if creds.json exists before proceeding
                        if (fs.existsSync('./session/creds.json')) {
                            const auth_path = './session/';
                            const user_jid = jidNormalizedUser(PrabathPairWeb.user.id);

                            function randomMegaId(length = 6, numberLength = 4) {
                                const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++) {
                                    result += characters.charAt(Math.floor(Math.random() * characters.length));
                                }
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            // Upload the credentials to mega
                            const mega_url = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                            const string_session = mega_url.replace('https://mega.nz/file/', '');
                            const sid = string_session;

                            // Send the session ID to the user's WhatsApp
                            await PrabathPairWeb.sendMessage(user_jid, {
                                text: sid
                            });
                        } else {
                            console.log("No creds.json file found in session directory");
                        }
                    } catch (e) {
                        console.log("Error in open connection handler:", e);
                        exec('pm2 restart prabath');
                    }

                    await delay(100);
                    // Remove session files after sending the credentials
                    removeFile('./session');
                    process.exit(0);
                } else if (connection === "close") {
                    // Handle reconnection with more robust error checking
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401 &&
                                           lastDisconnect?.error?.output?.statusCode !== 410;
                    
                    if (shouldReconnect) {
                        await delay(10000);
                        PrabathPair();
                    } else {
                        // Don't retry if authentication failed
                        console.log("Authentication failed, not retrying connection");
                        await removeFile('./session');
                        if (!res.headersSent) {
                            await res.send({ code: "Authentication failed" });
                        }
                    }
                }
            });
        } catch (err) {
            console.log("Error in PrabathPair function:", err);
            exec('pm2 restart prabath');
            console.log("service restarted");
            PrabathPair();
            await removeFile('./session');
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }
    return await PrabathPair();
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart prabath');
});

module.exports = router;