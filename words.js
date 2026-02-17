const words = [
  "apple",
  "car",
  "house",
  "elephant",
  "computer",
  "guitar",
  "mountain",
  "ocean",
  "pizza",
  "football",
];

function getRandomWords(count = 3) {
  const shuffled = [...words].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

module.exports = { getRandomWords };
