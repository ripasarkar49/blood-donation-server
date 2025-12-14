const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require("express");
const cors=require('cors');
require('dotenv').config()
const port=process.env.PORT||3000
const app=express()
const uri = process.env.URI;
app.use(cors());
app.use(express.json())

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const verifyFBToken=async(req,res,next)=>{
  const token=req.headers.authorization;
  if (!token) {
    return res.status(401).send({message:"unathorize access"})
  }
  try{
    const idToken=token.split(' ')[1]
    const decoded=await admin.auth().verifyIdToken(idToken)
    console.log("decoded info",decoded)
    req.decoded_email=decoded.email
    next()
    
  }
  catch(error){
     return res.status(401).send({message:"unathorize access"})
  }

}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database=client.db('paymentDB')
    const usercollection=database.collection('user')
    const requestsCollection=database.collection('requests')
    app.post('/users',async(req,res)=>{
        const userInfo=req.body;
        userInfo.role="donar";
        userInfo.status="active";
        userInfo.createdAt=new Date();
        const result=await usercollection.insertOne(userInfo);
        res.send(result)
    })

    app.get('/users/role/:email',async(req,res)=>{
        const {email}=req.params
        const query={email:email}
        const result=await usercollection.findOne(query)
        // console.log(result);
        res.send(result)
    })

    app.post('/requests',verifyFBToken, async(req,res)=>{
        const data=req.body;
        data.createdAt=new Date();
        const result=await requestsCollection.insertOne(data);
        res.send(result)
    })

    app.get('/manager/products/:email',async(req,res)=>{
      const email=req.params.email;
      const query={managerEmail:email};
      const result=await productCollection.find(query).toArray();
      res.send(result)
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/',(req,res)=>{
    res.send('Hello,Developer')

    
})
app.listen(port,()=>{
    console.log(`server is running on ${port}`);
    
})