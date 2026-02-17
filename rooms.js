const rooms = {};

function createRoom(roomId) {
  rooms[roomId] = {
    players: [],
    drawer: null,
    currentWord: null,
    wordOptions: [],
    timer: null,
    roundTime: 0,
  };

  return rooms[roomId];
}

function joinRoom(roomId, player) {
  const room = rooms[roomId];
  if (!room) return null;

  room.players.push(player);
  return room;
}

function removePlayer(socketId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    room.players = room.players.filter(
      (p) => p.socketId !== socketId
    );

    if (room.players.length === 0) {
      delete rooms[roomId];
    }
  }
}


module.exports = {
  rooms,
  createRoom,
  joinRoom,
  removePlayer,
};
