const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_password}@cluster0.xggde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
   serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
   },
});

async function run() {
   try {
      // Connect the client to the server	(optional starting in v4.7)
      await client.connect();
      // Send a ping to confirm a successful connection
      await client.db("admin").command({ ping: 1 });
      console.log(
         "Pinged your deployment. You successfully connected to MongoDB!"
      );

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

      //    Home route
      app.get("/", async (req, res) =>
         res.send("Danke, dass du mich geschlagen hast.")
      );
      //    save user to users_collection
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
      //    get user role
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
      // get all approved sessions - 9 data every time
      app.get("/get-all-sessions", async (req, res) => {
         const { page = 1, searchValue = "", filterBy = "all" } = req.query;
         const today = new Date();
         const todayString = today.toISOString();
         // TODO: add option for upcoming
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
      // get featured sessions - 6 data
      app.get("/featured-sessions", async (req, res) => {
         try {
            const todayString = new Date().toISOString();
            const latestSessions = await studySessionsCollection
               .find({
                  status: "approved",
                  classStartDate: { $gte: todayString },
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
      // get the average review
      app.get("/get-average-review/:id", async (req, res) => {
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
                        averageRating: 1,
                     },
                  },
               ])
               .next();
            console.log(avRating);
            res.send(avRating);
         } catch (error) {
            res.status(500).send({
               message: `Internal Server Error - ${error.message}`,
            });
         }
      });

      // ---------------------------------------------------------------------
      // -------------------- API for Tutors -------------------
      // ------ API for create session page --------
      // get all study sessions for specific tutor
      app.get("/tutor-study-sessions", async (req, res) => {
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
      });

      // post study session from tutor
      app.post("/add-study-session", async (req, res) => {
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
      });

      // review rejected session request by tutor
      app.patch("/review-rejected-session/:id", async (req, res) => {
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
      });

      // upload materials
      app.post("/upload-a-new-material", async (req, res) => {
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
      });

      // get all materials
      app.get("/get-tutor-materials/:email", async (req, res) => {
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
      });

      // get a single material for update
      app.get("/get-tutor-material/:id", async (req, res) => {
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
      });

      // update material data
      app.patch("/update-material/:id", async (req, res) => {
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
      });

      // delete material by tutor
      app.delete("/delete-material/:id", async (req, res) => {
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
      });

      // ---------------------------------------------------------------------
      // -------------------- API for students -------------------
      // ------ API for notes page --------
      // get notes of specific student
      app.get("/student-notes/:email", async (req, res) => {
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
      });
      // add note to db
      app.post("/student-notes", async (req, res) => {
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
      app.delete("/delete-note/:id", async (req, res) => {
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
      });
      // edit a note
      app.patch("/update-note/:id", async (req, res) => {
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
      });
      // get student booked sessions
      app.get("/student-booked-sessions/:email", async (req, res) => {
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
      });
      // already booked sessions
      app.get("/already-booked-session", async (req, res) => {
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
      });
      // add booked session
      app.post("/all-booked-sessions", async (req, res) => {
         try {
            const bookedData = req.body;
            await allBookedCollection.insertOne(bookedData);
            res.status(200).send({
               success: true,
               message: `You have successfully booked the session. ${
                  bookedData.paymentStatus === "incomplete"
                     ? "Please complete your payment to access session materials"
                     : ""
               } `,
            });
         } catch (error) {
            res.status(500).send({
               message: `Internal Server Error - ${error.message}`,
            });
         }
      });
      // add review
      app.post("/add-review", async (req, res) => {
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
      app.get("/already-submitted-review", async (req, res) => {
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
      });
      // already submitted review
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
      // get materials for students
      app.get("/get-student-materials/:email", async (req, res) => {
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
      });

      // ---------------------------------------------------------------------
      // -------------------- API for admin -------------------
      // get all users
      app.get("/get-all-users/:email", async (req, res) => {
         try {
            const { searchQuery = "", roleFilter = "all" } = req.query;
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
            const users = await usersCollection.find(filters).toArray();
            res.send(users);
         } catch (error) {
            res.status(500).send({
               message: `Internal Server Error - ${error.message}`,
            });
         }
      });
      // update role by admin
      app.patch("/update-user-role/:id", async (req, res) => {
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
      });
      // get all pending sessions
      app.get("/pending-sessions", async (req, res) => {
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
      app.get("/approved-sessions", async (req, res) => {
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
      });
      // update study session status and add rejection reason, feedback
      app.put("/update-session/:id", async (req, res) => {
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
               message: `Successfully ${
                  action === "approve" ? "approved" : "rejected"
               } the session`,
            });
         } catch (error) {
            res.status(500).send({
               message: `Internal Server Error - ${error.message}`,
            });
         }
      });
      // delete session by admin
      app.delete("/delete-session-by-admin/:id", async (req, res) => {
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
      });
      // get all materials
      app.get("/all-materials", async (req, res) => {
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
      app.delete("/delete-material-by-admin/:id", async (req, res) => {
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
      });
   } finally {
      //   await client.close();
   }
}
run().catch(console.dir);

app.listen(port, () => {
   console.log(`App listening on ${port}`);
});
