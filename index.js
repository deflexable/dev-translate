import express, { json } from 'express'
import { translateX } from './translate.js';

const app = express();

app.use(json());

app.post('/translate', async (req, res) => {
    try {
        const { string, to } = req.body;
        const result = await translateX(string, to);
        res.status(200).send({ result, status: 'success' });
    } catch (error) {
        console.error('req err:', error);
        res.sendStatus(500);
    }
});

app.listen(2739);

// const test = await translateX('Small boy with big money and wealth', 'zh');

// console.log('testRes:', test);