import express from 'express';
import type { Request, Response } from 'express';
import { Worker } from 'worker_threads';
import path from 'path';
const { exec } = require('child_process');
import fs from 'fs';
import cors from 'cors';

const app = express();
app.use(express.json({ limit: '10mb' })); 
const PORT = 8000;

app.use(cors({
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
    }));

// Singleton to manage the file watcher worker
class FileWatcherWorker {
    private static instance: FileWatcherWorker;
    private worker: Worker | null = null;
    private tempDir: string | null = null;

    private constructor() {}
    public static getInstance(): FileWatcherWorker {
        if (!FileWatcherWorker.instance) {
            FileWatcherWorker.instance = new FileWatcherWorker();
        }
        return FileWatcherWorker.instance;
    }

    public start(): Promise<string> {
        if (this.tempDir) {
            return Promise.resolve(this.tempDir);
        }

        return new Promise<string>((resolve, reject) => {
            this.worker = new Worker(path.join(__dirname, 'watcher.ts'), {
                execArgv: ['-r', 'ts-node/register'], // Ensures TypeScript is properly transpiled
            });

            this.worker.on('message', (message: { tempDir?: string }) => {
                if (message.tempDir) {
                    this.tempDir = message.tempDir;
                    resolve(this.tempDir);
                }
            });

            this.worker.on('error', (error) => {
                console.error('Worker encountered an error:', error);
                reject(error);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    public stop() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.tempDir = null;
        }
    }
}

function startFileWatcherWorker(): Promise<string> {
    return FileWatcherWorker.getInstance().start();
}

// Endpoint to start the worker
startFileWatcherWorker()

app.get('/stop-watcher', (req: Request, res: Response) => {
    const worker = FileWatcherWorker.getInstance();
    if (worker) {
        worker.stop();
        res.json({ message: 'File watcher stopped' });
    } else {
        res.status(500).json({ error: 'No file watcher running' });
    }
});

app.post('/generate-files', async (req: Request, res: Response) => {
    const body = req.body;

    const executeCommand = (command: string) =>
        new Promise<void>((resolve, reject) => {
            exec(command, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    console.error('Execution error:', error);
                    reject(error);
                } else if (stderr) {
                    console.error('Execution stderr:', stderr);
                    reject(new Error(stderr));
                } else {
                    console.log('Execution stdout:', stdout);
                    resolve();
                }
            });
        });

    try {
        // Ensure watch directory exists
        const watchDir = path.resolve(__dirname, 'watch');
        if (!fs.existsSync(watchDir)) {
            fs.mkdirSync(watchDir, { recursive: true });
        }

        // Run generateTerraform.ts
        await executeCommand(`bun run ./generateTerraform.ts -p ${body['provider']} -o ${watchDir}`);

        // Run each module
        if (Array.isArray(body['module'])) {
            for (const module of body['module']) {
                const modulePath = path.resolve(
                    __dirname,
                    'module',
                    `${body['provider']}`,
                    `generate${module.name}Terraform.ts`
                );
                const args = module.args?.join(' ') || '';

                // Execute each module script
                await executeCommand(`bun run ${modulePath} ${args} -o ${watchDir}`);
            }
        } else {
            console.log('No modules provided');
        }

        const generatedFilePath = path.join(watchDir, 'generatedFile.tf');
        const fileContent = fs.readFileSync(generatedFilePath, 'utf8');
        res.json({ message: 'File generation completed successfully', config: fileContent });
    } catch (error) {
        console.error('An unexpected error occurred:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
    }
});


const outputDir = path.resolve(__dirname, 'output');
const inputDir = path.resolve(__dirname, 'watch');

app.get('/output/files', (_req: Request, res: Response) => {
    fs.readdir(outputDir, (err, files) => {
        if (err) {
            console.error('Error reading output directory:', err);
            return res.status(500).json({ error: 'Could not list files' });
        }
        res.json({ files });
    });
});

// Endpoint to download a specific file by name
app.get('/output/:fileName', (req: Request, res: Response) => {
    const fileName = req.params.fileName + '.tf';
    const filePath = path.join(outputDir, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    // Set MIME type based on file extension
    const mimeType = getMimeType(fileName);
    res.setHeader('Content-Type', mimeType);

    res.sendFile(filePath);
});

app.delete('/output/:fileName', (req: Request, res: Response) => {
    const fileName = req.params.fileName;

    // Read all files in the output directory
    fs.readdir(inputDir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return res.status(500).json({ error: 'Error reading directory' });
        }

        // Filter files that contain the fileName substring
        const filesToDelete = files.filter(file => file.includes(fileName));

        // If no files match, respond with a 404 error
        if (filesToDelete.length === 0) {
            return res.status(404).json({ error: 'No files found matching the given name' });
        }

        // Delete each matching file
        let deleteErrors = [];
        filesToDelete.forEach(file => {
            const filePath = path.join(inputDir, file);
            fs.unlink(filePath, err => {
                if (err) {
                    console.error('Error deleting file:', file, err);
                    deleteErrors.push(file);
                }
            });
        });

        // After attempting to delete, respond based on results
        if (deleteErrors.length === 0) {
            res.json({ message: `All files containing "${fileName}" were deleted successfully` });
        } else {
            res.status(500).json({ error: `Error deleting some files: ${deleteErrors.join(', ')}` });
        }
    });
});

app.delete('/output', (_req: Request, res: Response) => {
    // Read all files in the output directory
    fs.readdir(inputDir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return res.status(500).json({ error: 'Error reading directory' });
        }

        // Delete each file
        let deleteErrors = [];
        files.forEach(file => {
            const filePath = path.join(inputDir, file);
            fs.unlink(filePath, err => {
                if (err) {
                    console.error('Error deleting file:', file, err);
                    deleteErrors.push(file);
                }
            });
        });

        // After attempting to delete, respond based on results
        if (deleteErrors.length === 0) {
            res.json({ message: 'All files were deleted successfully' });
        } else {
            res.status(500).json({ error: `Error deleting some files: ${deleteErrors.join(', ')}` });
        }
    });
});

// Helper function to detWermine MIME type based on file extension
function getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case '.html': return 'text/html';
        case '.js': return 'application/javascript';
        case '.json': return 'application/json';
        case '.css': return 'text/css';
        case '.txt': return 'text/plain';
        case '.jpg': return 'image/jpeg';
        case '.png': return 'image/png';
        case '.pdf': return 'application/pdf';
        case '.tf': return 'text/plain'; // For Terraform files
        default: return 'application/octet-stream'; // Fallback MIME type
    }
}


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
