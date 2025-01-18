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
            const data = req.body;
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
   } finally {
      //   await client.close();
   }
}
run().catch(console.dir);

app.listen(port, () => {
   console.log(`App listening on ${port}`);
});
