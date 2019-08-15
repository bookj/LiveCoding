const functions = require('firebase-functions');
const request = require("request-promise");

const fetch = require("node-fetch");

const line = require('@line/bot-sdk');

const admin = require('firebase-admin');
admin.initializeApp();
let db = admin.firestore();

const region = 'asia-east2';
const runtimeOpts = {
    timeoutSeconds: 4,
    memory: "2GB"
};

const vision = require('@google-cloud/vision');
const client = new vision.ImageAnnotatorClient();

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message";
const LINE_HEADER = {
    "Content-Type": "application/json",
    Authorization: "Bearer sDgTgZ4MX6LYwE89Ds/aS2MyLHxICMkwG/tZVYfZlSCLVnD01HpxNu9yAfpTwMi2i0cC8cOrxbLQhfwsXZOP20oztFv7xCPeFu9Iufj+dkFdPxYXlTiF1TWmUe6QJiuAQ9pylia1cSSP00vquabH1wdB04t89/1O/w1cDnyilFU="
};

// Push Message
const push = (userId, msg, quickItems) => {
    return request.post({
        headers: LINE_HEADER,
        uri: LINE_MESSAGING_API + '/push',
        body: JSON.stringify({
            to: userId,
            messages: [{ type: "text", text: msg, quickReply: quickItems }]
        })
    })
}

// Reply Message
const reply = (token, payload) => {
    return request.post({
        uri: LINE_MESSAGING_API + '/reply',
        headers: LINE_HEADER,
        body: JSON.stringify({
            replyToken: token,
            messages: [payload]
        })
    })
}

// Broadcast Messages
const broadcast = (msg) => {
    return request.post({
        uri: LINE_MESSAGING_API + '/broadcast',
        headers: LINE_HEADER,
        body: JSON.stringify({
            messages: [{ type: "text", text: msg }]
        })
    })
};

exports.UCL = functions.region(region).runWith(runtimeOpts)
    .https.onRequest(async (req, res) => {
        let event = req.body.events[0];
        switch (event.type) {
            case 'follow':
                let docRef = db.collection('userIds').doc(event.source.userId);
                let setAda = docRef.set({
                    uid: event.source.userId
                });
                break;
            case 'message':
                if (event.message.type === 'image') {
                    // [8.3]
                    doImage(event)
                } else if (event.message.type === 'text' && event.message.text === 'subscribe') {
                    // [8.2]
                    reply(event.replyToken, {
                        type: 'text',
                        text: 'กรุณายืนยันตัวตนด้วยการอัพโหลดรูปที่มีโลโกทีมที่คุณชื่นชอบ'
                    });
                } else {
                    // [8.1]
                    // Firebase Realtime Database
                    let latest = await admin.database().ref('ucl/score').once('value');
                    reply(event.replyToken, { type: 'text', text: latest.val() })

                    // Cloud Firestore
                    /*
                    let latest = await admin.firestore().doc('ucl/final').get()
                    reply(event.replyToken, {type:'text', text:latest.data().score})
                    */
                }
                break;
            case 'postback': {
                // [8.4]
                let msg = 'ทีมที่คุณเลือกมันเข้ารอบมาชิง UCL ซะทีไหนเล่า ปั๊ดโถ่!';
                let team = event.postback.data.split('=')[1]
                if (team.indexOf('liverpool') >= 0 || team.indexOf('tottenham') >= 0) {

                    // Firebase Realtime Database
                    await admin.database().ref('ucl/uid').child(event.source.userId).set(true)

                    // Cloud Firestore
                    // await admin.firestore().doc('ucl/final').collection('uid').doc(event.source.userId).set({})   

                    msg = 'ยินดีด้วยคุณผ่านการยืนยันตัวตน ระบบจะรายงานผลบอลคู่ชิงให้คุณทุกลมหายใจ';
                }
                reply(event.replyToken, { type: 'text', text: msg });

                break;
            }
        }
        return null;
    });

const doImage = async (event) => {
    const path = require("path");
    const os = require("os");
    const fs = require("fs");

    // กำหนด URL ในการไปดึง binary จาก LINE กรณีผู้ใช้อัพโหลดภาพมาเอง
    let url = LINE_MESSAGING_API + '/' + event.message.id + '/content';

    // ตรวจสอบว่าภาพนั้นถูกส่งมจาก LIFF หรือไม่
    if (event.message.contentProvider.type === 'external') {
        // กำหนด URL รูปภาพที่ LIFF ส่งมา 
        url = event.message.contentProvider.originalContentUrl;
    }

    // ดาวน์โหลด binary
    let buffer = await request.get({
        headers: LINE_HEADER,
        uri: url,
        encoding: null // แก้ปัญหา binary ไม่สมบูรณ์จาก default encoding ที่เป็น utf-8
    });

    // สร้างไฟล์ temp ใน local จาก binary ที่ได้
    const tempLocalFile = path.join(os.tmpdir(), 'temp.jpg');
    await fs.writeFileSync(tempLocalFile, buffer);

    // กำหนดชื่อ bucket ใน Cloud Storage for Firebase
    const bucket = admin.storage().bucket('chatbot-16e66.appspot.com');

    // อัพโหลดไฟล์ขึ้น Cloud Storage for Firebase
    await bucket.upload(tempLocalFile, {
        destination: event.source.userId + '.jpg', // ให้ชื่อไฟล์เป็น userId ของ LINE
        metadata: { cacheControl: 'no-cache' }
    });

    /// ลบไฟล์ temp หลังจากอัพโหลดเสร็จ
    fs.unlinkSync(tempLocalFile)

    // ตอบกลับเพื่อ handle UX เนื่องจากทั้งดาวน์โหลดและอัพโหลดต้องใช้เวลา
    reply(event.replyToken, { type: 'text', text: 'ขอคิดแป๊บนะเตง...' });
}

exports.logoDetection = functions.region(region).runWith(runtimeOpts)
    .storage.object()
    .onFinalize(async (object) => {
        const fileName = object.name // ดึงชื่อไฟล์มา
        const userId = fileName.split('.')[0] // แยกชื่อไฟล์ออกมา ซึ่งมันก็คือ userId

        // ทำนายโลโกที่อยู่ในภาพด้วย Cloud Vision API
        const [result] = await client.logoDetection('gs://' + object.bucket + '/' + fileName);
        const logos = result.logoAnnotations;

        // เอาผลลัพธ์มาเก็บใน array ซึ่งเป็นโครงสร้างของ Quick Reply
        let itemArray = []
        logos.forEach(logo => {
            if (logo.score >= 0.7) { // ค่าความแม่นยำของการทำนายต้องได้ตั้งแต่ 70% ขึ้นไป
                itemArray.push({
                    type: 'action',
                    action: {
                        type: 'postback', // action ประเภท postback
                        label: logo.description, // ชื่อที่จะแสดงในปุ่ม Quick Reply
                        data: 'team=' + logo.description, // ส่งข้อมูลทีมกลับไปแบบลับๆ
                        displayText: logo.description // ชื่อที่จะถูกส่งเข้าห้องแชทหลังจากคลิกปุ่ม Quick Reply
                    }
                });
            }
        })

        // กำหนดตัวแปรมา 2 ตัว
        let msg = '';
        let quickItems = null;

        // ตรวจสอบว่ามีผลลัพธ์การทำนายหรือไม่
        if (itemArray.length > 0) {
            msg = 'เลือกทีมที่คิดว่าใช่มาหน่อยซิ';
            quickItems = { items: itemArray };
        } else {
            msg = 'ไม่พบโลโกในภาพ ลองส่งรูปมาใหม่ซิ';
            quickItems = null;
        }

        // ส่งข้อความหาผู้ใช้ว่าพบโลโกหรือไม่ พร้อม Quick Reply(กรณีมีผลการทำนาย)
        push(userId, msg, quickItems)
    });

exports.liveScore = functions.region(region).runWith(runtimeOpts)
    .database.ref('ucl/score')
    .onWrite(async (change, context) => {

        let latest = change.after.val(); // ดึงค่าล่าสุดหลังการอัพเดทของ score ออกมา

        // ดึงข้อมูลผู้ใช้ที่ subscribe ทั้งหมด
        let userIds = await admin.database().ref('ucl/uid').once('value')

        Object.keys(userIds.val()).forEach(userId => {
            push(userId, latest, null) // ส่งข้อความแจ้งผลบอล
        })
    });

// exports.finalScore = functions.region(region).pubsub
//     .schedule('06 of aug 15:35')
//     .timeZone('Asia/Bangkok')
//     .onRun(async context => {

//         // ดึงผลการแข่งขันล่าสุด
//         let result = await admin.database().ref('ucl/score').once('value');

//         broadcast(`จบการแข่งขัน\n${result.val()}`); // ส่งข้อความหาทุกคนที่เป็น friend
//     });

exports.gatewayLoRa = functions.region(region).pubsub
    // .schedule('every mon 09:00')
    // .schedule('every 1 mins')
    .schedule('every day 09:00')
    .timeZone('Asia/Bangkok')
    .onRun(async context => {
        const urlGatewayRobot = 'http://noc.thethingsnetwork.org:8085/api/v2/gateways/eui-7276ff000b030d48';
        const urlGatewayREG = 'http://noc.thethingsnetwork.org:8085/api/v2/gateways/eui-7276ff000b030db9';
        const urlGatewayLRC = 'http://noc.thethingsnetwork.org:8085/api/v2/gateways/eui-7276ff000b030dca';

        let respGatewayRobot = await fetch(urlGatewayRobot);
        let jsonGatewayRobotData = await respGatewayRobot.json();
        if (OneDayAgo(Math.floor(parseInt(jsonGatewayRobotData.time, 10) / 1000000))) {
            const msg = "Gateway @Robot down !!!";
            push('U9e8ce3f4f5e677df139ffb4266c03e3b', msg, null) // ส่งข้อความถึง BOOK
            push('U20a5a624dac4fdf535a882b4e3011694', msg, null) // ส่งข้อความถึง P'Bee
        }

        let respGatewayREG = await fetch(urlGatewayREG);
        let jsonGatewayREGData = await respGatewayREG.json();
        if (OneDayAgo(Math.floor(parseInt(jsonGatewayREGData.time, 10) / 1000000))) {
            const msg = "Gateway @REG down !!!";
            push('U9e8ce3f4f5e677df139ffb4266c03e3b', msg, null) // ส่งข้อความถึง BOOK
            push('U20a5a624dac4fdf535a882b4e3011694', msg, null) // ส่งข้อความถึง P'Bee
        }

        // let respGatewayLRC = await fetch(urlGatewayLRC);
        // let jsonGatewayLRCData = await respGatewayLRC.json();
        // if(OneDayAgo(Math.floor(parseInt(jsonGatewayLRCData.time, 10) / 1000000))) {
        //     const msg = "Gateway @LRC down !!!";
        //     push('U9e8ce3f4f5e677df139ffb4266c03e3b', msg, null) // ส่งข้อความถึง BOOK
        //     push('U20a5a624dac4fdf535a882b4e3011694', msg, null) // ส่งข้อความถึง P'Bee
        // }
    });

exports.getsUserProfile = functions.region(region).pubsub
    .schedule('every day 00:00')
    .timeZone('Asia/Bangkok')
    .onRun(async context => {
        const client = new line.Client({
            channelAccessToken: 'sDgTgZ4MX6LYwE89Ds/aS2MyLHxICMkwG/tZVYfZlSCLVnD01HpxNu9yAfpTwMi2i0cC8cOrxbLQhfwsXZOP20oztFv7xCPeFu9Iufj+dkFdPxYXlTiF1TWmUe6QJiuAQ9pylia1cSSP00vquabH1wdB04t89/1O/w1cDnyilFU='
        });

        // client.getProfile('U9e8ce3f4f5e677df139ffb4266c03e3b')
        //     .then((profile) => {
        //         console.log(profile.displayName);
        //         console.log(profile.userId);
        //         console.log(profile.pictureUrl);
        //         console.log(profile.statusMessage);
        //     })
        //     .catch((err) => {
        //         // error handling
        //     });
        
        try {
            // Get all documents in a collection
            let userIdsRef = db.collection('userIds');
            let allUserIds = await userIdsRef.get();
            allUserIds.forEach(userId => {
                // let profile = await client.getProfile(userId.id)
                client.getProfile(userId.id)
                    .then((profile) => {
                        // Update a document
                        let userIdRef = userIdsRef.doc(userId.id);
                        let updateDisplayName = userIdRef.update({ displayName: profile.displayName }); // Set the 'displayName' field of the userId
                    });
                // console.log(userId.id, '=>', userId.data());
            });
        } catch (error) {
            console.log(error)
        }
    });

function convert(unixtimestamp) {
    // Months array
    var months_arr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var date = new Date(unixtimestamp);
    var year = date.getFullYear();
    var month = months_arr[date.getMonth()];
    var day = date.getDate();
    var hours = date.getHours();
    var minutes = "0" + date.getMinutes();
    var seconds = "0" + date.getSeconds();

    // Display date time in MM-dd-yyyy h:m:s format
    return month + '-' + day + '-' + year + ' ' + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
}

function OneDayAgo(yourDate) {
    const oneDay = 60 * 60 * 24 * 1000;
    const dayAgo = Date.now() - oneDay;

    return yourDate < dayAgo;
}