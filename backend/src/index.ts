import express from 'express';
import cors from 'cors';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Azure Migration Analyzer API - Running');
});

// Endpoint di test per verificare la connessione a Graph
app.get('/api/test-graph', async (req, res) => {
    try {
        // Usa Managed Identity su Azure o le tue credenziali locali
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        const query = "Resources | summarize count()";
        
        console.log("Esecuzione query su Graph...");
        const result = await client.resources({
            query: query
        });

        res.json({
            status: "Success",
            data: result.data,
            count: result.totalRecords
        });

    } catch (error: any) {
        console.error("Errore Graph:", error);
        res.status(500).json({
            status: "Error",
            message: error.message || "Errore sconosciuto"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server avviato su porta ${PORT}`);
});