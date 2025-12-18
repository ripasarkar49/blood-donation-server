const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const express = require("express");
const cors=require('cors');
require('dotenv').config()
const port=process.env.PORT||3000
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto=require('crypto')



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
    const paymentsCollection=database.collection('payments')
    app.post('/users',async(req,res)=>{
        const userInfo=req.body;
        userInfo.role="donar";
        userInfo.status="active";
        userInfo.createdAt=new Date();
        const result=await usercollection.insertOne(userInfo);
        res.send(result)
    })
    app.get('/users',verifyFBToken,async(req,res)=>{
      const result=await usercollection.find().toArray()
      res.status(200).send(result)

    })
    app.get('/users/role/:email',async(req,res)=>{
        const {email}=req.params
        const query={email:email}
        const result=await usercollection.findOne(query)
        // console.log(result);
        res.send(result)
    })
   
    app.patch('/update/user/status',verifyFBToken,async(req,res)=>{
        const {email,status}=req.query
        const query={email:email}
        const updateStatus={
          $set:{
            status:status
          }
        }
        const result= await usercollection.updateOne(query,updateStatus)
        res.send(result)
    })

        app.post('/requests', verifyFBToken, async (req, res) => {
        try {
        const email = req.decoded_email;

        const user = await usercollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (user.status !== "active") {
          return res.status(403).send({
            message: "Blocked users cannot create donation requests",
          });
        }

        const data = req.body;
        data.createdAt = new Date();
        data.req_email = email; 

        const result = await requestsCollection.insertOne(data);
        res.send(result);

      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get('/my-donation-requests',verifyFBToken,async(req,res)=>{
      const email=req.decoded_email;
      const size=Number(req.query.size)
      const page=Number(req.query.page)
      const { status } = req.query;
      const query={req_email:email};
      if (status) query.donation_status = status;
      const result=await requestsCollection
      .find(query)
      .limit(size)
      .skip(size*page)
      .toArray();

      const totalRequest=await requestsCollection.countDocuments(query);

      res.send({request:result,totalRequest})
    })
    app.patch("/accept-donation/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const email = req.decoded_email;
      const donor = await usercollection.findOne({ email });
      const result = await requestsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            donation_status: "inprogress",
            donorName: donor.name,
            donorEmail: donor.email,
          },
        }
      );

      res.send(result);
    });

    app.delete("/delete/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;

      const donation = await requestsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (donation.donation_status !== "pending") {
        return res
          .status(403)
          .send({ message: "Cannot delete after inprogress" });
      }

      const result = await requestsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });


    
    // profile updated 
    app.patch("/users/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email; 
      const { name, district, upazila, blood, mainPhotoUrl } = req.body;

      const query = { email };
      const updateDoc = {
        $set: {
          name,
          district,
          upazila,
          blood,
          mainPhotoUrl,
          updatedAt: new Date(),
        },
      };

      const result = await usercollection.updateOne(query, updateDoc);
      res.send(result);
    });
    app.get("/users/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const result = await usercollection.findOne({ email });
      res.send(result);
    });

  // payment 
  app.post('/create-payment-checkout',async(req,res)=>{
    const information=req.body;
    // console.log(information);
    const amount=parseInt(information.donateAmount)*100;
    const session=await stripe.checkout.sessions.create({
      line_items:[
        {
          price_data:{
            currency:'usd',
            unit_amount:amount,
            product_data:{
              name:'please Donate'
            }
          },
          quantity:1,
        },
      ],
      mode:'payment',
      metadata:{
        donorName:information?.donorName
      },
      customer_email:information.donorEmail,
      success_url:`${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${process.env.SITE_DOMAIN}/payment-cancelled`,
    });
    res.send({url:session.url })
    
  })

  app.post('/success-payment',async(req,res)=>{
    const {session_id}=req.query;
    const session=await stripe.checkout.sessions.retrieve(
     session_id
    )
    const transactionId=session.payment_intent;
    const isPaymentExist=await paymentsCollection.findOne({transactionId})
    if(isPaymentExist){
      console.log("helooooo");
      return res.status(400).send('Already Exist')
      
    }
    console.log('after verify');

    if (session.payment_status=='paid') {
      const paymentInfo={
        amount:session.amount_total/100,
        currency:session.currency,
        donorEmail:session.customer_email,
        transactionId,
        payment_status:session.payment_status,
        paidAt:new Date()
      }
      const result=await paymentsCollection.insertOne(paymentInfo)
      return res.send(result)
    }
    
  })

  app.get('/search-requests',async(req,res)=>{
    const {blood,district,upazila}=req.query;
    // console.log(req.query);
    const query={};
    if (!query) {
      return
    }
    if (blood) {
const fixed=blood.replace(/ /g,"+").trim();
      query.blood=fixed;  
    }
    if (district) {
      query.req_district=district;
    }
    if (upazila) {
      query.req_upazila=upazila;
    }
    // console.log(query);
    const result = await requestsCollection.find(query).toArray();
    res.send(result);
    
  })
  // get single donation request by id
    app.get("/donation/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await requestsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Donation not found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Invalid donation id" });
      }
    });


 

    // Update donation status (private)
    app.patch("/update-donation-status", verifyFBToken, async (req, res) => {
      const { id, status } = req.query;

      if (!id || !status) {
        return res.status(400).send({ message: "Missing id or status" });
      }

      try {
        const result = await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              donation_status: status,
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });

    //  donation requests status pending filter
    app.get("/pending-requests", async (req, res) => {
      try {
      
        const result = await requestsCollection
          .find({ donation_status: "pending" })
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error fetching requests" });
      }
    });

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