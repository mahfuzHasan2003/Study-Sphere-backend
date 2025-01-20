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
      app.get("/get-user-role", async (req, res) => {
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

      // ---------------------------------------------------------------------
      // -------------------- API for Tutors -------------------
      // ------ API for create session page --------
      // get all study sessions for specific tutor
      app.get("/tutor-study-sessions", async (req, res) => {
         try {
            const query = {
               tutorEmail: req.query.email,
               status: req.query.status,
            };

            const studeySessions = await studySessionsCollection
               .find(query)
               .toArray();
            res.send(studeySessions);
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
            const result = await studySessionsCollection.insertOne(data);
            res.status(200).send({
               success: true,
               message:
                  "Succesfully added a new study session! Please wait until the admin approves.",
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
   } finally {
      //   await client.close();
   }
}
run().catch(console.dir);

app.listen(port, () => {
   console.log(`App listening on ${port}`);
});
