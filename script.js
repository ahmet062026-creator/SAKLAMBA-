// DOM Elements
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');

const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const loginError = document.getElementById('login-error');
const loadingMsg = document.getElementById('loading-msg');

const lobbyRoomCode = document.getElementById('lobby-room-code');
const playerList = document.getElementById('player-list');
const lobbyStatus = document.getElementById('lobby-status');
const btnStartGame = document.getElementById('btn-start-game');

const gameArea = document.getElementById('game-area');
const roleDisplay = document.getElementById('role-display');
const timerDisplay = document.getElementById('timer-display');
const gameMessage = document.getElementById('game-message');

const resultMessage = document.getElementById('result-message');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');

// Game State
let isHost = false;
let myName = '';
let myId = '';
let roomCode = '';
let peer = null;
let connections = {}; // For Host: { peerId: dataConnection }
let hostConnection = null; // For Client: connection to Host

let players = {}; // { peerId: { name, isHost, role } }
let gameState = 'waiting'; // 'waiting', 'hiding', 'seeking'
let hiddenPosition = null;
let timerInterval = null;
let myRole = null;

const PREFIX = 'bsgame-'; // Prefix to avoid global PeerJS ID collisions

// Helpers
function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// HOST LOGIC
btnCreateRoom.addEventListener('click', () => {
    myName = playerNameInput.value.trim();
    if (!myName) return (loginError.innerText = 'Lütfen adınızı girin.');
    
    loginError.innerText = '';
    loadingMsg.innerText = 'Oda oluşturuluyor...';
    
    roomCode = generateRoomCode();
    myId = PREFIX + roomCode;
    
    peer = new Peer(myId);
    
    peer.on('open', (id) => {
        isHost = true;
        players[myId] = { name: myName, isHost: true, role: null };
        loadingMsg.innerText = '';
        showScreen(lobbyScreen);
        updateLobbyUI();
    });

    peer.on('connection', (conn) => {
        if (gameState !== 'waiting') {
            conn.on('open', () => conn.send({ type: 'error', message: 'Oyun zaten başladı.' }));
            setTimeout(() => conn.close(), 1000);
            return;
        }

        conn.on('data', (data) => {
            if (data.type === 'join') {
                players[conn.peer] = { name: data.name, isHost: false, role: null };
                connections[conn.peer] = conn;
                broadcast({ type: 'roomUpdate', players: players });
                updateLobbyUI();
            } else if (data.type === 'playerHidden') {
                hiddenPosition = { x: data.x, y: data.y };
                broadcast({ type: 'beginSeeking' });
                handleBeginSeeking();
            } else if (data.type === 'playerClicked') {
                checkClick(conn.peer, data.x, data.y);
            } else if (data.type === 'timeUp') {
                endGame('hider', null);
            }
        });

        conn.on('close', () => {
            delete players[conn.peer];
            delete connections[conn.peer];
            broadcast({ type: 'roomUpdate', players: players });
            updateLobbyUI();
        });
    });

    peer.on('error', (err) => {
        loginError.innerText = 'Bağlantı hatası: ' + err.message;
        loadingMsg.innerText = '';
    });
});

// CLIENT LOGIC
btnJoinRoom.addEventListener('click', () => {
    myName = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim();
    
    if (!myName) return (loginError.innerText = 'Lütfen adınızı girin.');
    if (!code || code.length !== 6) return (loginError.innerText = '6 haneli oda kodu girin.');

    loginError.innerText = '';
    loadingMsg.innerText = 'Odaya bağlanılıyor...';
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        myId = id;
        const hostId = PREFIX + code;
        hostConnection = peer.connect(hostId);
        
        hostConnection.on('open', () => {
            roomCode = code;
            hostConnection.send({ type: 'join', name: myName });
        });

        hostConnection.on('data', (data) => {
            if (data.type === 'error') {
                loginError.innerText = data.message;
                loadingMsg.innerText = '';
            } else if (data.type === 'roomUpdate') {
                players = data.players;
                loadingMsg.innerText = '';
                showScreen(lobbyScreen);
                updateLobbyUI();
            } else if (data.type === 'gameStarted') {
                players = data.players;
                myRole = players[myId].role;
                handleGameStart();
            } else if (data.type === 'beginSeeking') {
                handleBeginSeeking();
            } else if (data.type === 'missedClick') {
                if (myRole === 'seeker') {
                    gameMessage.innerText = 'Bilemedin! Tekrar dene.';
                    setTimeout(() => { if (gameState === 'seeking') gameMessage.innerText = 'Saklanan yerleşti! Tıklayarak onu bul.'; }, 1000);
                }
            } else if (data.type === 'gameOver') {
                showGameOver(data.winner, data.foundBy);
            }
        });

        hostConnection.on('close', () => {
            alert('Kurucu oyundan ayrıldı veya bağlantı koptu.');
            location.reload();
        });
    });

    peer.on('error', (err) => {
        loginError.innerText = 'Bağlantı hatası veya oda bulunamadı: ' + err.message;
        loadingMsg.innerText = '';
    });
});

// COMMON LOGIC
function broadcast(data) {
    if (!isHost) return;
    Object.values(connections).forEach(conn => {
        if (conn.open) conn.send(data);
    });
}

function updateLobbyUI() {
    lobbyRoomCode.innerText = roomCode;
    playerList.innerHTML = '';
    
    const pList = Object.values(players);
    pList.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name + (p.isHost ? ' (Kurucu)' : '');
        playerList.appendChild(li);
    });

    if (isHost) {
        if (pList.length >= 2) {
            btnStartGame.style.display = 'block';
            lobbyStatus.innerText = 'Oyunu başlatabilirsiniz.';
        } else {
            btnStartGame.style.display = 'none';
            lobbyStatus.innerText = 'Başlamak için en az 2 oyuncu gerekiyor.';
        }
    } else {
        btnStartGame.style.display = 'none';
        lobbyStatus.innerText = 'Kurucunun oyunu başlatması bekleniyor...';
    }
}

btnStartGame.addEventListener('click', () => {
    if (!isHost) return;
    gameState = 'playing';
    
    // Assign roles
    const playerIds = Object.keys(players);
    const hiderId = playerIds[Math.floor(Math.random() * playerIds.length)];
    
    playerIds.forEach(id => {
        players[id].role = (id === hiderId) ? 'hider' : 'seeker';
    });

    myRole = players[myId].role;
    
    broadcast({ type: 'gameStarted', players: players });
    handleGameStart();
});

function handleGameStart() {
    showScreen(gameScreen);
    gameArea.innerHTML = '';
    gameState = 'hiding';

    roleDisplay.innerText = myRole === 'hider' ? 'Rolün: SAKLANAN (Kamufle Ol)' : 'Rolün: EBE (Bekle)';
    
    if (myRole === 'hider') {
        gameMessage.innerText = 'Haritaya tıklayarak saklanacağın yeri seç (Kamufle ol)!';
        startTimer(15, () => {
            if (gameState === 'hiding') {
                const autoX = 400, autoY = 250;
                if (isHost) {
                    hiddenPosition = { x: autoX, y: autoY };
                    broadcast({ type: 'beginSeeking' });
                    handleBeginSeeking();
                } else {
                    hostConnection.send({ type: 'playerHidden', x: autoX, y: autoY });
                    gameState = 'hidden';
                }
            }
        });
    } else {
        gameMessage.innerText = 'Saklanan kişi yerini seçiyor. Lütfen bekle...';
        timerDisplay.innerText = 'Bekleniyor...';
    }
}

gameArea.addEventListener('click', (e) => {
    if (gameState === 'hiding' && myRole === 'hider') {
        const rect = gameArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        gameState = 'hidden';
        gameMessage.innerText = 'Saklandın! Ebelerin seni bulmasını bekle.';
        gameArea.innerHTML = `<div class="space-map"></div><div class="hider-marker" style="left: ${x}px; top: ${y}px;"></div>`;
        
        if (isHost) {
            hiddenPosition = { x, y };
            broadcast({ type: 'beginSeeking' });
            handleBeginSeeking();
        } else {
            hostConnection.send({ type: 'playerHidden', x, y });
        }
    } else if (gameState === 'seeking' && myRole === 'seeker') {
        const rect = gameArea.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (isHost) {
            checkClick(myId, x, y);
        } else {
            hostConnection.send({ type: 'playerClicked', x, y });
        }
    }
});

function handleBeginSeeking() {
    gameState = 'seeking';
    if (myRole === 'seeker') {
        gameMessage.innerText = 'Saklanan yerleşti! Tıklayarak onu bul.';
    } else {
        gameMessage.innerText = 'Ebeler seni arıyor! Hareketsiz kal...';
    }
    
    startTimer(30, () => {
        if (myRole === 'hider') {
            if (isHost) {
                endGame('hider', null);
            } else {
                hostConnection.send({ type: 'timeUp' });
            }
        }
    });
}

function checkClick(peerId, x, y) {
    if (!hiddenPosition) return;
    const hx = hiddenPosition.x;
    const hy = hiddenPosition.y;
    const dist = Math.sqrt(Math.pow(hx - x, 2) + Math.pow(hy - y, 2));
    
    if (dist < 30) {
        endGame('seekers', players[peerId].name);
    } else {
        if (peerId === myId) {
            gameMessage.innerText = 'Bilemedin! Tekrar dene.';
            setTimeout(() => { if (gameState === 'seeking') gameMessage.innerText = 'Saklanan yerleşti! Tıklayarak onu bul.'; }, 1000);
        } else if (connections[peerId]) {
            connections[peerId].send({ type: 'missedClick' });
        }
    }
}

function endGame(winner, foundBy) {
    gameState = 'waiting';
    broadcast({ type: 'gameOver', winner, foundBy });
    showGameOver(winner, foundBy);
}

function showGameOver(winner, foundBy) {
    clearInterval(timerInterval);
    showScreen(gameOverScreen);
    
    if (winner === 'seekers') {
        resultMessage.innerText = `Ebeler Kazandı! Bulan Kişi: ${foundBy}`;
    } else {
        resultMessage.innerText = 'Süre Doldu! Saklanan Kazandı (Kusursuz Kamuflaj)!';
    }
}

btnBackToLobby.addEventListener('click', () => {
    showScreen(lobbyScreen);
});

function startTimer(seconds, onComplete) {
    clearInterval(timerInterval);
    let timeLeft = seconds;
    timerDisplay.innerText = `Süre: ${timeLeft}s`;
    
    timerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = `Süre: ${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (onComplete) onComplete();
        }
    }, 1000);
}
