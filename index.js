const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();

const stripe = require("stripe")(process.env.stripe_secret);

app.use(
  cors({
    origin: ["http://localhost:5173", "https://study-sphere-c5d1e.web.app"],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_password}@cluster0.xggde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// DEBUG: some of data fetching publicly in the session details page, recheck it later

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //    "Pinged your deployment. You successfully connected to MongoDB!"
    // );

    //    Database and collections
    const database = client.db("studySphere");
    const usersCollection = database.collection("users_collection");
    const studySessionsCollection = database.collection(
      "study_sessions_collection"
    );
    const studentNotesCollection = database.collection(
      "student_notes_collection"
    );
    const allMaterialsCollection = database.collection(
      "all_materials_collection"
    );
    const allBookedCollection = database.collection(
      "all_booked_sessions_collection"
    );
    const allStudentReviewsCollection = database.collection(
      "student_reviews_collection"
    );

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.access_token, {
        expiresIn: "12h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.access_token, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };
    const verifyStudent = async (req, res, next) => {
      const email = req?.decoded?.email;
      const user = await usersCollection.findOne({
        userEmail: email,
      });
      if (!user?.userRole === "student") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };
    const verifyTutor = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({
        userEmail: email,
      });
      if (!user?.userRole === "tutor") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({
        userEmail: email,
      });
      if (!user?.userRole === "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // payment intent
    app.post(
      "/create-payment-intent",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        const { sessionId } = req.body;
        const session = await studySessionsCollection.findOne({
          _id: new ObjectId(sessionId),
        });

        if (!session) res.status(400).send({ message: "session not found" });

        const amount = parseInt(session?.registrationFee) * 100;

        // Get tutor's connected Stripe account ID
        const sessionTutor = await usersCollection.findOne({ userEmail: session?.tutorEmail })

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],

          application_fee_amount: Math.floor(amount * 0.3),
          transfer_data: {
            destination: sessionTutor?.tutorStripeId,
          },
        });

        res.send({
          clientSecret: paymentIntent.client_secret, tutorStripeId: sessionTutor?.tutorStripeId
        });
      }
    );

    // Create a connected account
    app.post("/create-stripe-account-link", verifyToken, verifyTutor, async (req, res) => {
      try {

        // getting a stripe connect account
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
        });

        // Saving the account ID in DB
        const { userID } = req.body;
        await usersCollection.updateOne({ _id: new ObjectId(userID) }, {
          $set: { tutorStripeId: account.id }
        })

        // getting a stripe connect account for TUTOR
        const accountLink = await stripe.accountLinks.create({
          account: account.id,
          refresh_url: `${process.env.Frontend_Base_URL}/dashboard/my-balance`,
          return_url: `${process.env.Frontend_Base_URL}/dashboard/my-balance`,
          type: 'account_onboarding',
        });

        res.status(200).json({
          url: accountLink.url,
        });

      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });

    // get admin balance
    app.get("/balance/admin", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const balance = await stripe.balance.retrieve();
        res.send(balance);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    })

    // get tutor balance
    app.get("/balance/tutor/:id", verifyToken, verifyTutor, async (req, res) => {
      try {
        const balance = await stripe.balance.retrieve({ stripeAccount: req.params.id });
        res.send(balance);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }

    })



    // Home route
    app.get("/", async (req, res) =>
      res.send("Danke, dass du mich geschlagen hast.")
    );
    // save user to users_collection
    app.post("/post-user", async (req, res) => {
      try {
        const userData = req.body;

        //  for new user via social login
        const socialLogin = req.query.social ? true : false;
        if (socialLogin) {
          const filter = { userEmail: userData.userEmail };
          const result = await usersCollection.updateOne(
            filter,
            { $setOnInsert: userData },
            { upsert: true }
          );
          res.send(result);
          return;
        }
        //  manually signuped new user
        const result = await usersCollection.insertOne(userData);
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get available sessions count by tutor email
    app.get("/approved-sessions-count", async (req, res) => {
      const { email } = req.query;
      try {
        const count = await studySessionsCollection.countDocuments({
          status: "approved",
          tutorEmail: email,
        });
        res.send({ count });
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get random 10 tutors who have session added
    app.get("/top-tutors", async (req, res) => {
      const tutors = await usersCollection
        .aggregate([
          { $match: { userRole: "tutor" } },
          { $sample: { size: 25 } },
        ])
        .toArray();
      const tutorsWithSessions = await Promise.all(
        tutors.map(async (tutor) => {
          const sessions = await studySessionsCollection
            .find({ status: "approved", tutorEmail: tutor.userEmail })
            .limit(1)
            .toArray();
          return sessions.length > 0 ? tutor : null;
        })
      );
      res.send(tutorsWithSessions.filter(Boolean).slice(0, 10));
    });
    // get all approved sessions - 9 data every time
    app.get("/get-all-sessions", async (req, res) => {
      const { page = 1, searchValue = "", filterBy = "all" } = req.query;
      const todayString = new Date().toISOString();
      const query = {
        status: "approved",
        ...(searchValue && {
          sessionTitle: { $regex: searchValue, $options: "i" },
        }),
        ...(filterBy === "ongoing" && {
          registrationStartDate: { $lte: todayString },
          registrationEndDate: { $gte: todayString },
        }),
        ...(filterBy === "upcoming" && {
          registrationStartDate: { $gt: todayString },
        }),
        ...(filterBy === "closed" && {
          registrationEndDate: { $lt: todayString },
        }),
      };
      const totalDataFound = await studySessionsCollection.countDocuments(
        query
      );
      const sessions = await studySessionsCollection
        .find(query)
        .skip((page - 1) * 9)
        .limit(9)
        .toArray();
      res.status(200).send({
        totalDataFound,
        sessions,
        currentPage: Number(page),
        totalPages: Math.ceil(totalDataFound / 9),
      });
    });
    // get ongoing sessions - 6 data
    app.get("/ongoing-sessions", async (req, res) => {
      try {
        const todayString = new Date().toISOString();
        const latestSessions = await studySessionsCollection
          .find({
            status: "approved",
            registrationEndDate: { $gte: todayString },
            registrationStartDate: { $lte: todayString },
          })
          .limit(6)
          .toArray();
        res.send(latestSessions);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get featured sessions - 6 data
    app.get("/featured-sessions", async (req, res) => {
      try {
        const latestSessions = await studySessionsCollection
          .find({ status: "approved" })
          .sort({ _id: -1 })
          .limit(6)
          .toArray();
        res.send(latestSessions);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get sessions details
    app.get("/get-session-details/:id", async (req, res) => {
      try {
        const data = await studySessionsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(data);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // specific tutor sessions
    app.get("/tutor/:email/sessions", async (req, res) => {
      try {
        const { email } = req.params;
        const sessions = await studySessionsCollection
          .find({ tutorEmail: email, status: "approved" })
          .toArray();
        res.send(sessions);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get the average review
    app.get("/get-average-rating/:id", async (req, res) => {
      try {
        const avRating = await allStudentReviewsCollection
          .aggregate([
            {
              $match: { sessionId: req.params.id },
            },
            {
              $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
              },
            },
            {
              $project: {
                _id: 0,
                averageRating: { $round: ["$averageRating", 1] },
              },
            },
          ])
          .next();
        res.send(avRating);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get all submitted reviews for a selected session
    app.get("/get-reviews/:id", async (req, res) => {
      try {
        const result = await allStudentReviewsCollection
          .find({
            sessionId: req.params.id,
          })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });

    // get logged in user details with role
    app.get("/get-user-with-role", async (req, res) => {
      try {
        const query = { userEmail: req.query.email };
        const user = await usersCollection.findOne(query);
        res.send(user);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get a user details with role
    app.get("/get-specific-user/:email", async (req, res) => {
      try {
        const query = { userEmail: req.params.email };
        const user = await usersCollection.findOne(query);
        res.send(user);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });

    app.patch("/update-profile/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const updateFields = req.body;
        await usersCollection.updateOne(
          { userEmail: email },
          {
            $set: { ...updateFields },
          }
        );
        res
          .status(200)
          .send({ success: true, message: "Data updated successfully" });
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // ---------------------------------------------------------------------
    // -------------------- API for students -------------------
    // ------ API for notes page --------
    // get student booked sessions
    app.get(
      "/student-booked-sessions/:email",
      // NOTE: verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const result = await allBookedCollection
            .find({ studentEmail: req.params?.email })
            .toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // already booked sessions
    app.get(
      "/already-booked-session",
      // NOTE: verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const { id, user } = req.query;
          const result = await allBookedCollection.findOne({
            sessionId: id,
            studentEmail: user,
          });
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // post data to booked session
    app.post(
      "/all-booked-sessions",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const bookedData = req.body;
          await allBookedCollection.insertOne(bookedData);
          res.status(200).send({
            success: true,
            message: `You have successfully booked the session. ${bookedData.paymentStatus === "incomplete"
              ? "Please complete your payment to access session materials"
              : ""
              } `,
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // after successful payment, update the payment status
    app.patch(
      "/update-payment-status/:id",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const result = await allBookedCollection.updateOne(
            {
              _id: new ObjectId(req.params.id),
            },
            { $set: { paymentStatus: "paid" } }
          );

          res.status(200).send({
            success: true,
            message:
              "Payment successful. Check your materials and become your own Spider-Man!",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get notes of specific student
    app.get(
      "/student-notes/:email",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const query = { email: req.params.email };
          const studentNotes = await studentNotesCollection
            .find(query)
            .sort({ date: -1 })
            .toArray();
          res.send(studentNotes);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // add note to db
    app.post("/student-notes", verifyToken, verifyStudent, async (req, res) => {
      try {
        const note = req.body;
        const result = await studentNotesCollection.insertOne(note);
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // delete a note
    app.delete(
      "/delete-note/:id",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const result = await studentNotesCollection.deleteOne({
            _id: new ObjectId(req.params.id),
          });
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // edit a note
    app.patch(
      "/update-note/:id",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const { title, description } = req.body;
          const query = { _id: new ObjectId(req.params.id) };
          const updatedData = {
            $set: {
              title,
              description,
              date: new Date().toISOString(),
            },
          };
          const result = await studentNotesCollection.updateOne(
            query,
            updatedData
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // add review
    app.post("/add-review", verifyToken, verifyStudent, async (req, res) => {
      try {
        await allStudentReviewsCollection.insertOne({ ...req.body });
        res.status(200).send({
          success: true,
          message: "Review added successfully. Thanks for submitting",
        });
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // already submitted review
    app.get(
      "/already-submitted-review",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const { id, user } = req.query;
          const result = await allStudentReviewsCollection.findOne({
            sessionId: id,
            studentEmail: user,
          });
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get materials for students
    app.get(
      "/get-student-materials/:email",
      verifyToken,
      verifyStudent,
      async (req, res) => {
        try {
          const bookedSessions = await allBookedCollection
            .find({ studentEmail: req.params.email })
            .toArray();
          const bookedSessionIds = bookedSessions?.map(
            (session) => session.sessionId
          );
          const materials = await allMaterialsCollection
            .find({
              sessionId: { $in: bookedSessionIds },
            })
            .toArray();
          res.send(materials);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );

    // ---------------------------------------------------------------------
    // -------------------- API for Tutors -------------------
    // ------ API for create session page --------
    // get all study sessions for specific tutor
    app.get(
      "/tutor-study-sessions",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const query = {
            tutorEmail: req?.query?.email,
            status: req?.query?.status,
          };

          const studySessions = await studySessionsCollection
            .find(query)
            .toArray();
          res.send(studySessions);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // create new study session
    app.post(
      "/add-study-session",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const data = { requestAttempt: 1, ...req.body };
          await studySessionsCollection.insertOne(data);
          res.status(200).send({
            success: true,
            message:
              "Succesfully submitted a new study session! Please wait until the admin approves.",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // create review request for rejected session
    app.patch(
      "/review-rejected-session/:id",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const updatedData = {
            $inc: { requestAttempt: 1 },
            $set: {
              status: "pending",
            },
          };
          await studySessionsCollection.updateOne(
            {
              _id: new ObjectId(req.params.id),
            },
            updatedData
          );
          res.status(200).send({
            success: true,
            message:
              "Succesfully sent a review request. Please wait until the admin approves.",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // upload materials
    app.post(
      "/upload-a-new-material",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const {
            sessionId,
            materialTitle,
            tutorEmail,
            materialDriveLink,
            materialCoverImage,
          } = req.body;
          const { sessionTitle } = await studySessionsCollection.findOne(
            {
              _id: new ObjectId(sessionId),
            },
            { projection: { sessionTitle: 1 } }
          );
          await allMaterialsCollection.insertOne({
            sessionId,
            sessionTitle,
            tutorEmail,
            materialTitle,
            materialDriveLink,
            materialCoverImage,
          });
          res.status(200).send({
            success: true,
            message: "Material uploaded successfully.",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get all materials for tutor
    app.get(
      "/get-tutor-materials/:email",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const result = await allMaterialsCollection
            .find({
              tutorEmail: req.params.email,
            })
            .toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get a single material for update
    app.get(
      "/get-tutor-material/:id",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const material = await allMaterialsCollection.findOne({
            _id: new ObjectId(req.params.id),
          });
          res.send(material);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // update material data
    app.patch(
      "/update-material/:id",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          const { materialTitle, materialDriveLink } = req.body;
          await allMaterialsCollection.updateOne(
            {
              _id: new ObjectId(req.params.id),
            },
            {
              $set: {
                materialTitle,
                materialDriveLink,
              },
            }
          );
          res.status(200).send({
            success: true,
            message: "Successfully saved your changes.",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // delete material by tutor
    app.delete(
      "/delete-material/:id",
      verifyToken,
      verifyTutor,
      async (req, res) => {
        try {
          await allMaterialsCollection.deleteOne({
            _id: new ObjectId(req.params.id),
          });
          res.status(200).send({
            success: true,
            message: "Your material has been deleted",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );

    // ---------------------------------------------------------------------
    // -------------------- API for admin -------------------
    // get all users
    app.get(
      "/get-all-users/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const {
            searchQuery = "",
            roleFilter = "all",
            page = 1,
            limit = 10,
          } = req.query;
          const { email = "" } = req.params;
          const filters = {
            userEmail: { $ne: email },
          };
          // search filtering
          if (searchQuery) {
            filters.$or = [
              { userName: { $regex: searchQuery, $options: "i" } },
              { userEmail: { $regex: searchQuery, $options: "i" } },
            ];
          }
          // role filtering
          if (roleFilter !== "all") {
            filters.userRole = roleFilter;
          }
          const totalUsers = await usersCollection.countDocuments(filters);

          const users = await usersCollection
            .find(filters)
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .toArray();
          res.send({
            totalUsers,
            users,
            currentPage: Number(page),
            totalPages: Math.ceil(totalUsers / limit),
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // update role by admin
    app.patch(
      "/update-user-role/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await usersCollection.updateOne(
            {
              _id: new ObjectId(req.params.id),
            },
            {
              $set: {
                userRole: req.body.newRole,
              },
            }
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get all pending sessions
    app.get("/pending-sessions", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const pensionSessions = await studySessionsCollection
          .find({ status: "pending" })
          .toArray();
        res.send(pensionSessions);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // get all approved sessions
    app.get(
      "/approved-sessions",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const approvedSessions = await studySessionsCollection
            .find({ status: "approved" })
            .toArray();
          res.send(approvedSessions);
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // update study session status and add rejection reason, feedback
    app.put(
      "/update-session/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { action, additionalData } = req.body;

        try {
          let updatedData = {};
          if (action === "approve") {
            updatedData = {
              $set: {
                status: "approved",
                registrationFee: parseInt(additionalData.registrationFee),
              },
              $unset: {
                requestAttempt: "",
                rejectionReason: "",
                rejectionFeedback: "",
              },
            };
          } else if (action === "reject") {
            updatedData = {
              $set: {
                status: "rejected",
                rejectionReason: additionalData.rejectionReason,
                rejectionFeedback: additionalData.rejectionFeedback,
              },
            };
          }
          await studySessionsCollection.updateOne(
            {
              _id: new ObjectId(id),
            },
            updatedData
          );
          res.status(200).send({
            success: true,
            message: `Successfully ${action === "approve" ? "approved" : "rejected"
              } the session`,
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // delete session by admin
    app.delete(
      "/delete-session-by-admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          await studySessionsCollection.deleteOne({
            _id: new ObjectId(req.params.id),
          });
          res.status(200).send({
            success: true,
            message: "Successfully deleted the session",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
    // get all materials
    app.get("/all-materials", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await allMaterialsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: `Internal Server Error - ${error.message}`,
        });
      }
    });
    // delete material by admin
    app.delete(
      "/delete-material-by-admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          await allMaterialsCollection.deleteOne({
            _id: new ObjectId(req.params.id),
          });
          res.status(200).send({
            success: true,
            message: "Your material has been deleted",
          });
        } catch (error) {
          res.status(500).send({
            message: `Internal Server Error - ${error.message}`,
          });
        }
      }
    );
  } finally {
    //   await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`App listening on ${port}`);
});
