const calculateAvgRating = (reviews) => {
  const ratings = reviews.map((item) => item.rating);
  const total = ratings.reduce((partialSum, a) => partialSum + a, 0);

  if (reviews.length === 0) return parseFloat(0);
  return parseFloat(total / reviews.length);
};

module.exports = { calculateAvgRating };
