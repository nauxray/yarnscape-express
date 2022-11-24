const express = require("express");
const { ObjectId, Timestamp } = require("mongodb");
const mongoUtils = require("./utils/mongoUtils");
const { generateAccessToken, authenticateToken } = require("./utils/jwtUtils");
const { encrypt, decrypt } = require("./utils/encryptionUtils");
const { calculateAvgRating } = require("./utils/calculateRating");

const PORT = 8000;
const dbName = "yarnReviewData";
const collections = {
  yarns: "yarns",
  users: "users",
  reviews: "reviews",
  materials: "materials",
  brands: "brands",
};

require("dotenv").config();
const url = process.env.MONGO_URI;
const app = express();

app.use(
  express.urlencoded({
    extended: false,
  })
);

app.use(express.json()); //required for postman POST req with raw JSON data

async function main() {
  await mongoUtils.connect(url, dbName);
  console.log("connected to the database:", dbName);

  const db = mongoUtils.getDB();
  const yarnsColl = await db.collection(collections.yarns);
  const usersColl = await db.collection(collections.users);
  const reviewsColl = await db.collection(collections.reviews);

  // yarn routes
  app.get("/yarns", async function (req, res) {
    try {
      const queryObj = {};
      const sortObj = {};
      const reqQuery = req.query;
      const queryKeys = Object.keys(reqQuery);

      if (queryKeys.length > 0) {
        queryKeys.forEach((key) => {
          const value = reqQuery[key];
          if (value.length === 0) return;

          switch (key) {
            case "name":
            case "color":
              queryObj[key] = { $regex: new RegExp(value, "i") };
              break;
            case "brand":
              queryObj[key] = value;
              break;
            case "weight":
              queryObj[key] = parseInt(value);
              break;
            case "materials":
              queryObj[key] = { $elemMatch: { _id: value } };
              break;
            case "sort":
              if (value.startsWith("name")) {
                sortObj.name = value.split(":")[1] === "asc" ? 1 : -1;
              }
              if (value.startsWith("rating")) {
                sortObj.average_rating = value.split(":")[1] === "asc" ? 1 : -1;
              }
              if (value.startsWith("reviews")) {
                sortObj.reviewCount = value.split(":")[1] === "asc" ? 1 : -1;
              }
              break;
            default:
              break;
          }
        })
      }

      const aggregateArr = [
        {
          "$project": {
            "name": 1,
            "color": 1,
            "weight": 1,
            "average_rating": 1,
            "posted_by": 1,
            "brand": 1,
            "recommended_hook_size": 1,
            "recommended_needle_size": 1,
            "materials": 1,
            "reviews": 1,
            "img_url": 1,
            "created_at": 1,
            "reviewCount": { "$size": "$reviews" }
          }
        },
        { $match: queryObj }
      ];

      if (Object.keys(sortObj).length > 0) {
        aggregateArr.push({ $sort: sortObj });
      }

      const yarns = await yarnsColl.aggregate(aggregateArr).toArray();
      res.status(200).send(yarns);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/yarns/:id", async function (req, res) {
    try {
      const id = req.params.id;
      const yarnListing = await yarnsColl.findOne({ _id: ObjectId(id) });
      res.status(200).send(yarnListing);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.post("/yarns", authenticateToken, async (req, res) => {
    try {
      const {
        name,
        color,
        weight,
        brand,
        hook_size,
        needle_size,
        materials,
        img_url,
      } = req.body;

      if (
        !name ||
        !color ||
        !weight ||
        !hook_size ||
        !needle_size ||
        !materials
      ) {
        res.status(400).send("Required fields not filled");
        return;
      }

      const authorId = req.user.userId;
      const newYarnDoc = {
        name,
        color,
        weight,
        average_rating: 0,
        posted_by: authorId,
        brand,
        recommended_hook_size: hook_size,
        recommended_needle_size: needle_size,
        materials,
        reviews: [],
        img_url: img_url ?? [],
        created_at: new Timestamp(),
      };

      const result = await yarnsColl.insertOne(newYarnDoc);
      res.status(201).send(result);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  // user routes
  app.post("/users/create", async function (req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).send("Required fields not filled");
        return;
      }

      const regex = new RegExp(/^[a-z0-9]+$/i);
      if (!regex.test(username)) {
        res.status(409).send("Username must be alphanumeric");
        return;
      }

      const usernameExists = !!(await usersColl.findOne({ username }));
      if (usernameExists) {
        res.status(409).send("Username already exists");
        return;
      }

      const newUser = {
        username,
        password: encrypt(password),
        reviews: [],
        created_at: new Timestamp(),
      };

      const result = await usersColl.insertOne(newUser);
      res.status(201).send({ jwt: generateAccessToken(result.insertedId) });
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.post("/login", async function (req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).send("Required fields not filled");
        return;
      }

      const matchingUser = await usersColl.findOne({ username });
      if (!matchingUser || decrypt(matchingUser.password) !== password) {
        res.status(401).send("Invalid credentials");
        return;
      }

      res.status(200).send({ jwt: generateAccessToken(matchingUser._id) });
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/users/:id", async function (req, res) {
    try {
      const matchingUser = await usersColl.findOne(
        { _id: ObjectId(req.params.id) },
        { projection: { password: 0 } }
      );

      res.status(200).send(matchingUser);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.put("/users/:id", authenticateToken, async function (req, res) {
    try {
      const userId = req.params.id;
      const { username, password } = req.body;

      if (!username && !password) {
        res.sendStatus(400);
        return;
      }

      if (userId !== req.user.userId) {
        res.sendStatus(401);
        return;
      }

      let updateObj = {};
      if (!!username) updateObj.username = username;
      if (!!password) updateObj.password = encrypt(password);

      await usersColl.updateOne({ _id: ObjectId(userId) }, { $set: updateObj });

      res.sendStatus(204);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  // review routes
  app.get("/reviews/yarn/:id", async function (req, res) {
    try {
      const reviews = await reviewsColl
        .find({ yarn: ObjectId(req.params.id) }, { projection: { yarn: 0 } })
        .toArray();

      res.status(200).send(reviews);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/reviews/user/:id", async function (req, res) {
    try {
      const reviews = await reviewsColl
        .find(
          { author: ObjectId(req.params.id) },
          { projection: { author: 0 } }
        )
        .toArray();

      res.status(200).send(reviews);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.post("/reviews/:id", authenticateToken, async function (req, res) {
    try {
      const { content, rating, img_url } = req.body;
      const yarnId = req.params.id;
      const authorId = req.user.userId;

      const newReviewDoc = {
        content,
        rating,
        author: ObjectId(authorId),
        yarn: ObjectId(yarnId),
        img_url,
        created_at: new Timestamp(),
      };

      const result = await reviewsColl.insertOne(newReviewDoc);

      const updatedReviews = await reviewsColl
        .find({ yarn: ObjectId(yarnId) }, { projection: { rating: 1 } })
        .toArray();
      // add review Id to yarn document, update avg rating
      await yarnsColl.updateOne(
        { _id: ObjectId(yarnId) },
        {
          $push: { reviews: result.insertedId },
          $set: { average_rating: calculateAvgRating(updatedReviews) },
        }
      );
      // add review Id to user document
      await usersColl.updateOne(
        { _id: ObjectId(authorId) },
        { $push: { reviews: result.insertedId } }
      );

      res.status(201).send(result);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.put("/reviews/:id", authenticateToken, async function (req, res) {
    try {
      const { content, rating, img_url } = req.body;
      const reviewId = req.params.id;

      const reviewToEdit = await reviewsColl.findOne({
        _id: ObjectId(reviewId),
      });

      // verify token user === review author
      const author = await usersColl.findOne({
        _id: ObjectId(reviewToEdit.author),
      });

      const jwtUserId = req.user.userId;
      if (!author || author._id.toString() !== jwtUserId) {
        res.sendStatus(401);
        return;
      }
      // update review doc
      await reviewsColl.updateOne(
        { _id: ObjectId(reviewId) },
        { $set: { content, rating, img_url } }
      );
      // update yarn avg rating
      if (rating !== reviewToEdit.rating) {
        const updatedReviews = await reviewsColl
          .find({ yarn: reviewToEdit.yarn }, { projection: { rating: 1 } })
          .toArray();

        await yarnsColl.updateOne(
          { _id: reviewToEdit.yarn },
          { $set: { average_rating: calculateAvgRating(updatedReviews) } }
        );
      }

      res.sendStatus(204);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.delete("/reviews/:id", authenticateToken, async function (req, res) {
    try {
      const reviewId = req.params.id;

      const reviewToDelete = await reviewsColl.findOne({
        _id: ObjectId(reviewId),
      });
      // verify token user === review author
      const author = await usersColl.findOne({
        _id: ObjectId(reviewToDelete.author),
      });

      const jwtUserId = req.user.userId;
      if (!author || author._id.toString() !== jwtUserId) {
        res.sendStatus(401);
        return;
      }
      // delete review document
      await reviewsColl.deleteOne({
        _id: ObjectId(reviewId),
      });
      // delete review Id from yarn document & update avg rating
      const updatedReviews = await reviewsColl
        .find({ yarn: reviewToDelete.yarn }, { projection: { rating: 1 } })
        .toArray();

      await yarnsColl.updateOne(
        { _id: reviewToDelete.yarn },
        {
          $pull: { reviews: ObjectId(reviewId) },
          $set: { average_rating: calculateAvgRating(updatedReviews) },
        }
      );
      // delete review Id from user document
      await usersColl.updateOne(
        { _id: reviewToDelete.author },
        { $pull: { reviews: ObjectId(reviewId) } }
      );

      res.sendStatus(204);
    } catch (error) {
      res.status(500).send({ error });
    }
  });
}

main();
app.listen(PORT, function () {
  console.log("server started on port", PORT);
});
