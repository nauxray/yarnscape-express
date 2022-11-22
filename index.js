const express = require("express");
const { ObjectId, Timestamp } = require("mongodb");
const mongoUtils = require("./utils/mongoUtils");
const { generateAccessToken, authenticateToken } = require("./utils/jwtUtils");
const { encrypt, decrypt } = require("./utils/encryptionUtils");

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

      res.status(200).send({
        data: yarnListings,
      });
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

      res.status(200).send({
        data: yarnListing,
      });
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

      const authorUsername = req.user.username;

      if (
        !name ||
        !color ||
        !weight ||
        !hook_size ||
        !needle_size ||
        !materials ||
        !authorUsername
      ) {
        res.status(400).send("Required fields not filled");
        return;
      }

      const author = await db.collection(collections.users).findOne({
        username: authorUsername,
      });

      const newYarnDoc = {
        name,
        color,
        weight,
        average_rating: 0,
        posted_by: author._id,
        brand,
        recommended_hook_size: hook_size,
        recommended_needle_size: needle_size,
        materials,
        reviews: [],
        img_url: img_url ?? [],
        created_at: new Timestamp(),
      };

      const newId = await db
        .collection(collections.yarns)
        .insertOne(newYarnDoc);

      res.status(201).send({ newId });
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

      // ToDo: input validation, check username exist

      const newUser = {
        username,
        password: encrypt(password),
        reviews: [],
        created_at: new Timestamp(),
      };

      const newUserId = await db
        .collection(collections.users)
        .insertOne(newUser);

      const jwt = generateAccessToken(username);

      res.status(201).send({ newUserId, jwt });
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

      const jwt = generateAccessToken(username);

      res.status(200).send({ jwt });
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  app.get("/users/:id", async function (req, res) {
    try {
      const db = mongoUtils.getDB();

      const matchingUser = await db.collection(collections.users).findOne({
        _id: ObjectId(req.params.id),
      });

      if (!matchingUser) {
        res.status(404).send("User not found");
        return;
      }

      const userObj = Object.assign({}, matchingUser);
      delete userObj.password;

      res.status(200).send({ data: matchingUser });
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

      const userObj = await db.collection(collections.users).findOne({
        _id: ObjectId(userId),
      });

      const jwtUsername = req.user.username;
      if (!userObj || userObj.username !== jwtUsername) {
        res.sendStatus(401);
        return;
      }

      let updateObj = {};
      if (!!username) updateObj.username = username;
      if (!!password) updateObj.password = encrypt(password);

      await db.collection(collections.users).updateOne(
        {
          _id: ObjectId(userId),
        },
        {
          $set: updateObj,
        }
      );

      res.sendStatus(200);
    } catch (error) {
      res.status(500).send({ error });
    }
  });

  // review routes
  app.get("/reviews/:yarnId", async function (req, res) {
    const db = mongoUtils.getDB();
    // return content, rating, img_url, author, yarns used, created_at
    // sorted latest to oldest
  });

  app.get("/reviews/:userId", async function (req, res) {
    const db = mongoUtils.getDB();
    // return content, rating, img_url, yarns used, created_at
    // sorted latest to oldest
  });
  app.post("/reviews", async function (req, res) {
    const db = mongoUtils.getDB();
    // body: content, rating, author id, yarns used
    // return _id of new review
  });

  app.put("/reviews/:id", async function (req, res) {
    const db = mongoUtils.getDB();
    // body: content, rating, author id, yarns used
  });

  app.delete("/reviews/:id", async function (req, res) {
    const db = mongoUtils.getDB();
  });
}

main();
app.listen(PORT, function () {
  console.log("server started on port", PORT);
});
