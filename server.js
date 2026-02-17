const express = require("express");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const { getRandomWords } = require("./words");
const { createRoom, joinRoom, removePlayer, rooms } = require("./rooms");
const { log } = require("./logger");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
});

io.on("connection", (socket) => {
    log("INFO", "User connected", { socketId: socket.id });

    /* ============================
          CREATE ROOM
    ============================ */
    socket.on("create-room", ({ username }) => {
        const roomId = crypto.randomBytes(4).toString("hex");

        createRoom(roomId);
        joinRoom(roomId, { socketId: socket.id, username, score: 0 });

        socket.join(roomId);

        const room = rooms[roomId];

        log("ROOM", "Room created", { roomId, creator: username });

        socket.emit("room-created", roomId);
        sendRoomData(roomId);
    });

    /* ============================
          JOIN ROOM
    ============================ */
    socket.on("join-room", ({ roomId, username }) => {
        const room = joinRoom(roomId, {
            socketId: socket.id,
            username,
            score: 0
        });

        if (!room) {
            socket.emit("error-message", "Room does not exist");
            return;
        }

        socket.join(roomId);

        log("ROOM", "Player joined", { roomId, username });

        sendRoomData(roomId);

        // ✅ Start game only if 2+ players & no active drawer
        if (room.players.length >= 2 && !room.drawer) {
            startTurn(roomId);
        }
    });

    /* ============================
          SELECT WORD
    ============================ */
    socket.on("select-word", ({ roomId, word }) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.drawer !== socket.id) return;
        if (!room.wordOptions.includes(word)) return;

        room.currentWord = word;
        room.wordOptions = [];

        // Send real word to drawer
        socket.emit("word-selected", word);

        // Send hidden word to others
        socket.to(roomId).emit("word-selected", "_ ".repeat(word.length));

        startRound(roomId);
    });

    /* ============================
          DRAW EVENT
    ============================ */
    socket.on("draw", ({ roomId, data }) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.drawer !== socket.id || !room.currentWord) return;

        socket.to(roomId).emit("draw", data);
    });

    /* ============================
          CLEAR CANVAS
    ============================ */
    socket.on("clear-canvas", (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.drawer !== socket.id) return;

        socket.to(roomId).emit("clear-canvas");
    });

    /* ============================
          CHAT
    ============================ */
    socket.on("chat-message", ({ roomId, username, message }) => {
        const room = rooms[roomId];
        if (!room) return;

        // Ignore if round not active
        if (!room.roundActive || !room.currentWord) {
            io.to(roomId).emit("chat-message", {
                username,
                message,
            });
            return;
        }

        // 🚫 Drawer cannot guess
        if (socket.id === room.drawer) {
            return;
        }

        // 🚨 Anti-spam cooldown (1 second per guess)
        const now = Date.now();
        const lastTime = room.lastGuessTime?.[socket.id] || 0;

        if (now - lastTime < 1000) {
            return; // Ignore spam
        }

        room.lastGuessTime[socket.id] = now;

        const cleanedMessage = message.trim().toLowerCase();
        const correctWord = room.currentWord.toLowerCase();

        // 🎯 Correct Guess
        if (cleanedMessage === correctWord) {
            // Prevent duplicate scoring
            if (room.correctGuessers.includes(socket.id)) {
                return;
            }

            const guesser = room.players.find(
                (p) => p.socketId === socket.id
            );

            const drawer = room.players.find(
                (p) => p.socketId === room.drawer
            );

            if (!guesser || !drawer) return;

            // 🔥 TIME-BASED SCORING
            const guesserPoints = room.roundTime * 2;
            const drawerPoints = room.roundTime * 1;

            guesser.score += guesserPoints;
            drawer.score += drawerPoints;

            room.correctGuessers.push(socket.id);

            io.to(roomId).emit("chat-message", {
                username: "SYSTEM",
                message: `${username} guessed the word! +${guesserPoints} pts 🎉`,
            });

            // Update scoreboard
            sendRoomData(roomId);

            // If everyone except drawer guessed → end round
            const totalGuessers = room.players.length - 1;

            if (room.correctGuessers.length === totalGuessers) {
                clearInterval(room.timer);
                endRound(roomId);
            }

            return;
        }

        // ❌ Wrong guess → show as normal chat
        io.to(roomId).emit("chat-message", {
            username,
            message,
        });
    });



    /* ============================
          DISCONNECT
    ============================ */
    socket.on("disconnect", () => {
        log("INFO", "User disconnected", { socketId: socket.id });
        removePlayer(socket.id);
    });
});

/* ============================================
        GAME LOGIC
============================================ */

function startTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return;

    // Assign first drawer if none
    if (!room.drawer) {
        room.drawer = room.players[0].socketId;
    }

    log("GAME", "New turn started", { roomId, drawer: room.drawer });

    const options = getRandomWords(3);
    room.wordOptions = options;
    room.currentWord = null;

    sendRoomData(roomId);

    // Send word options only to drawer
    io.to(room.drawer).emit("word-options", options);
}

function startRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.roundTime = 30;
    room.roundActive = true;
    room.correctGuessers = [];
    room.lastGuessTime = {}; // 🔥 anti-spam tracking

    io.to(roomId).emit("timer-update", room.roundTime);

    room.timer = setInterval(() => {
        room.roundTime--;

        io.to(roomId).emit("timer-update", room.roundTime);

        if (room.roundTime <= 0) {
            clearInterval(room.timer);
            endRound(roomId);
        }
    }, 1000);
}


function endRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.roundActive = false;

    io.to(roomId).emit("chat-message", {
        username: "SYSTEM",
        message: `Time's up! Word was: ${room.currentWord}`,
    });

    room.currentWord = null;

    rotateDrawer(roomId);
}


function rotateDrawer(roomId) {
    const room = rooms[roomId];
    if (!room || room.players.length === 0) return;

    const currentIndex = room.players.findIndex(
        (p) => p.socketId === room.drawer
    );

    const nextIndex = (currentIndex + 1) % room.players.length;

    room.drawer = room.players[nextIndex].socketId;

    io.to(roomId).emit("clear-canvas");

    startTurn(roomId);
}

function sendRoomData(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit("room-data", {
        players: room.players,
        drawer: room.drawer,
    });
}


/* ============================================ */

server.listen(5000, "0.0.0.0", () => {
    log("SYSTEM", "Server running on port 5000");
});
