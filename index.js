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

  // yarn routes
  app.get("/yarns", async function (req, res) {
    try {
      const db = mongoUtils.getDB();
      const yarnListings = await db
        .collection(collections.yarns)
        .find({})
        .toArray();

      res.status(200).send(yarnListings);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/yarns/:id", async function (req, res) {
    try {
      const id = req.params.id;
      const db = mongoUtils.getDB();

      const yarnListing = await db.collection(collections.yarns).findOne({
        _id: ObjectId(id),
      });

      res.status(200).send(yarnListing);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.post("/yarns", authenticateToken, async (req, res) => {
    try {
      const db = mongoUtils.getDB();

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

      const result = await db
        .collection(collections.yarns)
        .insertOne(newYarnDoc);

      res.status(201).send(result);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  // user routes
  app.post("/users/create", async function (req, res) {
    try {
      const db = mongoUtils.getDB();
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

      const usersCollection = await db.collection(collections.users);
      const usernameExists = !!(await usersCollection.findOne({ username }));
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

      const result = await usersCollection.insertOne(newUser);
      res.status(201).send({ jwt: generateAccessToken(result.insertedId) });
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.post("/login", async function (req, res) {
    try {
      const db = mongoUtils.getDB();
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).send("Required fields not filled");
        return;
      }

      const matchingUser = await db.collection(collections.users).findOne({
        username,
      });

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
      const db = mongoUtils.getDB();

      const matchingUser = await db
        .collection(collections.users)
        .findOne(
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
      const db = mongoUtils.getDB();
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

      await db
        .collection(collections.users)
        .updateOne({ _id: ObjectId(userId) }, { $set: updateObj });

      res.sendStatus(204);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  // review routes
  app.get("/reviews/yarn/:id", async function (req, res) {
    try {
      const db = mongoUtils.getDB();
      const reviews = await db
        .collection(collections.reviews)
        .find({ yarn: ObjectId(req.params.id) }, { projection: { yarn: 0 } })
        .toArray();

      res.status(200).send(reviews);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/reviews/user/:id", async function (req, res) {
    try {
      const db = mongoUtils.getDB();
      const reviews = await db
        .collection(collections.reviews)
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
      const db = mongoUtils.getDB();
      const { content, rating, img_url } = req.body;
      const yarnId = req.params.id;
      const authorId = req.user.userId;

      const yarnsCollection = await db.collection(collections.yarns);
      const reviewsCollection = await db.collection(collections.reviews);

      const newReviewDoc = {
        content,
        rating,
        author: ObjectId(authorId),
        yarn: ObjectId(yarnId),
        img_url,
        created_at: new Timestamp(),
      };

      const result = await reviewsCollection.insertOne(newReviewDoc);

      const updatedReviews = await reviewsCollection
        .find({ yarn: ObjectId(yarnId) }, { projection: { rating: 1 } })
        .toArray();
      // add review Id to yarn document, update avg rating
      await yarnsCollection.updateOne(
        { _id: ObjectId(yarnId) },
        {
          $push: { reviews: result.insertedId },
          $set: { average_rating: calculateAvgRating(updatedReviews) },
        }
      );
      // add review Id to user document
      await db
        .collection(collections.users)
        .updateOne(
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
      const db = mongoUtils.getDB();
      const { content, rating, img_url } = req.body;
      const reviewId = req.params.id;

      const reviewsCollection = await db.collection(collections.reviews);
      const reviewToEdit = await reviewsCollection.findOne({
        _id: ObjectId(reviewId),
      });

      // verify token user === review author
      const author = await db.collection(collections.users).findOne({
        _id: ObjectId(reviewToEdit.author),
      });

      const jwtUserId = req.user.userId;
      if (!author || author._id.toString() !== jwtUserId) {
        res.sendStatus(401);
        return;
      }
      // update review doc
      await reviewsCollection.updateOne(
        { _id: ObjectId(reviewId) },
        { $set: { content, rating, img_url } }
      );
      // update yarn avg rating
      if (rating !== reviewToEdit.rating) {
        const updatedReviews = await reviewsCollection
          .find({ yarn: reviewToEdit.yarn }, { projection: { rating: 1 } })
          .toArray();

        await db
          .collection(collections.yarns)
          .updateOne(
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
      const db = mongoUtils.getDB();
      const reviewId = req.params.id;

      const usersCollection = await db.collection(collections.users);
      const reviewsCollection = await db.collection(collections.reviews);

      const reviewToDelete = await reviewsCollection.findOne({
        _id: ObjectId(reviewId),
      });
      // verify token user === review author
      const author = await usersCollection.findOne({
        _id: ObjectId(reviewToDelete.author),
      });

      const jwtUserId = req.user.userId;
      if (!author || author._id.toString() !== jwtUserId) {
        res.sendStatus(401);
        return;
      }
      // delete review document
      await reviewsCollection.deleteOne({
        _id: ObjectId(reviewId),
      });
      // delete review Id from yarn document & update avg rating
      const updatedReviews = await reviewsCollection
        .find({ yarn: reviewToDelete.yarn }, { projection: { rating: 1 } })
        .toArray();

      await db.collection(collections.yarns).updateOne(
        { _id: reviewToDelete.yarn },
        {
          $pull: { reviews: ObjectId(reviewId) },
          $set: { average_rating: calculateAvgRating(updatedReviews) },
        }
      );
      // delete review Id from user document
      await usersCollection.updateOne(
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
