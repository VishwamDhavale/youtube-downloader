import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import youtubeDlPkg from 'youtube-dl-exec';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

interface DownloadTask {
  id: string;
  url: string;
  outputFolder: string;
  format?: string;
  formatExt?: string;
  formatVcodec?: string;
  formatAcodec?: string;
  title?: string;
  thumbnail?: string;
  downloadSubtitles?: boolean;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
  message: string;
  emitter: EventEmitter;
  subprocess?: any;
}

const tasks: Map<string, DownloadTask> = new Map();

const runPickerCommand = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(command, args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout.trim());
    });
  });

const selectFolder = async () => {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Select output folder'",
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }'
    ].join('; ');

    return runPickerCommand('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }

  if (process.platform === 'darwin') {
    return runPickerCommand('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Select output folder")'
    ]);
  }

  try {
    return await runPickerCommand('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select output folder'
    ]);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }

  return runPickerCommand('kdialog', ['--getexistingdirectory', process.env.HOME || '/']);
};

// Session Management Utility
const getSessionFilePath = (folder: string) => path.join(folder, 'ytdl-session.json');

const updateSessionFile = (folder: string, task: Partial<DownloadTask>) => {
  try {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const sessionFile = getSessionFilePath(folder);
    let sessionData: any[] = [];
    if (fs.existsSync(sessionFile)) {
      sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    }
    
    const index = sessionData.findIndex(t => t.id === task.id);
    if (index !== -1) {
      sessionData[index] = { ...sessionData[index], ...task, emitter: undefined, subprocess: undefined };
    } else {
      sessionData.push({ ...task, emitter: undefined, subprocess: undefined });
    }
    
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  } catch (err) {
    console.error('Failed to update session file:', err);
  }
};

app.post('/api/sessions', (req, res) => {
  const { outputFolder } = req.body;
  if (!outputFolder) return res.status(400).json({ error: 'Output folder is required' });

  const sessionFile = getSessionFilePath(outputFolder);
  if (!fs.existsSync(sessionFile)) {
    return res.json([]);
  }

  try {
    const sessionData: any[] = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    
    // Sanitize and sync with in-memory tasks
    const sanitizedSessions = sessionData.map(task => {
      // If a task was 'downloading' but the server was restarted, it should be 'paused'
      const status = (task.status === 'downloading' || task.status === 'pending') ? 'paused' : task.status;
      
      const syncedTask: DownloadTask = {
        ...task,
        status,
        emitter: new EventEmitter(),
        subprocess: undefined
      };
      
      // Add to in-memory tasks if not already there so it can be resumed
      if (!tasks.has(syncedTask.id)) {
        tasks.set(syncedTask.id, syncedTask);
      }
      
      return {
        id: syncedTask.id,
        url: syncedTask.url,
        title: syncedTask.title,
        thumbnail: syncedTask.thumbnail,
        progress: syncedTask.progress,
        status: syncedTask.status,
        message: syncedTask.message,
        downloadSubtitles: syncedTask.downloadSubtitles
      };
    });

    res.json(sanitizedSessions);
  } catch (err) {
    console.error('Failed to read session file:', err);
    res.status(500).json({ error: 'Failed to read session file' });
  }
});

app.post('/api/select-folder', async (_req, res) => {
  try {
    const folder = await selectFolder();

    if (!folder) {
      return res.json({ folder: '' });
    }

    res.json({ folder });
  } catch (error: any) {
    if (error.code === 1) {
      return res.json({ folder: '' });
    }

    if (error.code === 'ENOENT') {
      return res.status(500).json({
        error: 'No folder picker found. Install zenity or kdialog, then try again.'
      });
    }

    console.error('Folder picker error:', error);
    res.status(500).json({ error: error.message || 'Failed to open folder picker' });
  }
});

app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const ytDl: any = youtubeDlPkg;
    const execFunc = ytDl.exec || ytDl;

    // Use --dump-json to get all metadata
    // --flat-playlist to quickly get playlist items without full metadata
    const info = await execFunc(url, {
      dumpJson: true,
      flatPlaylist: true,
      noCheckCertificates: true,
    });

    const parsedInfo = JSON.parse(info.stdout);
    
    // Extract useful fields
    const metadata = {
      id: parsedInfo.id,
      title: parsedInfo.title,
      thumbnail: parsedInfo.thumbnail,
      isPlaylist: parsedInfo._type === 'playlist',
      duration: parsedInfo.duration,
      uploader: parsedInfo.uploader,
      formats: parsedInfo.formats?.map((f: any) => ({
        formatId: f.format_id,
        ext: f.ext,
        resolution: f.resolution || (f.width ? `${f.width}x${f.height}` : 'audio only'),
        vcodec: f.vcodec,
        acodec: f.acodec,
        note: f.format_note,
        filesize: f.filesize || f.filesize_approx
      })).filter((f: any) => 
        (f.vcodec !== 'none' || f.acodec !== 'none') && 
        f.protocol !== 'mhtml' && 
        !f.format_note?.includes('storyboard')
      ) || []
    };

    res.json(metadata);
  } catch (error: any) {
    console.error('Info error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transcript', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // Import the ESM build directly — the package has a bug where "type":"module"
    // conflicts with its CJS "main" entry, so we bypass it.
    const { fetchTranscript } = await import('youtube-transcript/dist/youtube-transcript.esm.js');
    const transcript = await fetchTranscript(url);
    res.json(transcript);
  } catch (error: any) {
    console.error('Transcript error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
});

app.post('/api/comments', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const ytDl: any = youtubeDlPkg;
    const execFunc = ytDl.exec || ytDl;

    const info = await execFunc(url, {
      dumpJson: true,
      writeComments: true,
      noCheckCertificates: true,
      playlistItems: '0',
    });

    const parsedInfo = JSON.parse(info.stdout);
    const comments = parsedInfo.comments || [];
    
    res.json({
      commentCount: parsedInfo.comment_count,
      comments: comments.map((c: any) => ({
        id: c.id,
        author: c.author,
        text: c.text,
        likeCount: c.like_count,
        timeText: c.time_text,
        isFavorited: c.is_favorited,
        parent: c.parent
      }))
    });
  } catch (error: any) {
    console.error('Comments error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch comments' });
  }
});

app.post('/api/download', (req, res) => {
  const { url, outputFolder, format, formatExt, formatVcodec, formatAcodec, title, thumbnail, downloadSubtitles } = req.body;

  if (!url || !outputFolder) {
    return res.status(400).json({ error: 'URL and output folder are required' });
  }

  const taskId = uuidv4();
  const emitter = new EventEmitter();

  const task: DownloadTask = {
    id: taskId,
    url,
    outputFolder,
    format,
    formatExt,
    formatVcodec,
    formatAcodec,
    title,
    thumbnail,
    downloadSubtitles,
    progress: 0,
    status: 'pending',
    message: 'Starting download...',
    emitter
  };

  tasks.set(taskId, task);
  updateSessionFile(outputFolder, task);

  startDownload(task);
  res.json({ taskId });
});

app.post('/api/action', (req, res) => {
  const { taskId, action } = req.body;
  const task = tasks.get(taskId);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (action === 'pause' || action === 'stop') {
    if (task.subprocess) {
      task.subprocess.kill('SIGINT'); // yt-dlp stops gracefully with SIGINT
      task.status = 'paused';
      task.message = 'Paused';
      task.emitter.emit('update');
      updateSessionFile(task.outputFolder, task);
    }
    return res.json({ status: 'paused' });
  }

  if (action === 'resume') {
    if (task.status === 'paused' || task.status === 'error') {
      startDownload(task);
    }
    return res.json({ status: 'resuming' });
  }

  if (action === 'cancel') {
    if (task.subprocess) task.subprocess.kill('SIGTERM');
    tasks.delete(taskId);
    return res.json({ status: 'cancelled' });
  }

  res.status(400).json({ error: 'Invalid action' });
});

app.get('/api/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendUpdate = () => {
    res.write(`data: ${JSON.stringify({
      progress: task.progress,
      status: task.status,
      message: task.message
    })}\n\n`);
  };

  sendUpdate();
  const onUpdate = () => sendUpdate();
  task.emitter.on('update', onUpdate);

  req.on('close', () => {
    task.emitter.off('update', onUpdate);
  });
});

async function startDownload(task: DownloadTask) {
  try {
    if (!fs.existsSync(task.outputFolder)) {
      fs.mkdirSync(task.outputFolder, { recursive: true });
    }

    task.status = 'downloading';
    task.message = 'Downloading...';
    task.emitter.emit('update');

    const ytDl: any = youtubeDlPkg;
    const execFunc = ytDl.exec || ytDl;

    const options: any = {
      output: path.join(task.outputFolder, '%(title)s.%(ext)s'),
      newline: true,
      progress: true,
      noCheckCertificates: true,
    };

    if (task.downloadSubtitles) {
      options.writeAutoSubs = true;
      options.writeSubs = true;
      options.subLangs = 'en'; // Download English subtitles, or we could leave it generic to download all
    }

    if (task.format) {
      const selectedExt = task.formatExt?.toLowerCase();
      const wantsMp4 = selectedExt === 'mp4';
      const hasCodecInfo = Boolean(task.formatVcodec || task.formatAcodec);
      const isAudioOnly = task.formatVcodec === 'none' && task.formatAcodec !== 'none';
      const isVideoOnly = task.formatVcodec !== 'none' && task.formatAcodec === 'none';
      const isCombined = task.formatVcodec !== 'none' && task.formatAcodec !== 'none';
      const isSimpleId = /^\d+$/.test(task.format);

      if (wantsMp4) {
        options.mergeOutputFormat = 'mp4';
      }

      if (hasCodecInfo && isVideoOnly && wantsMp4) {
        options.format = `${task.format}+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      } else if (hasCodecInfo && isVideoOnly) {
        options.format = `${task.format}+bestaudio/best`;
      } else if (hasCodecInfo && (isCombined || isAudioOnly)) {
        options.format = task.format;
      } else if (isSimpleId && !task.format.includes('+')) {
        // Backward-compatible fallback for resumed tasks created before codec details were stored.
        options.format = `${task.format}+bestaudio/best`;
      } else {
        options.format = task.format;
      }
    }

    const subprocess = execFunc(task.url, options);
    task.subprocess = subprocess;

    if (subprocess.stdout) {
      subprocess.stdout.on('data', (data: Buffer) => {
        const line = data.toString();
        const match = line.match(/\[download\]\s+(\d+\.\d+)%/);
        if (match && match[1]) {
          task.progress = parseFloat(match[1]);
          task.message = `Downloading: ${task.progress}%`;
          task.emitter.emit('update');
          // Update session file periodically or on significant progress
          if (Math.floor(task.progress) % 5 === 0) {
            updateSessionFile(task.outputFolder, task);
          }
        } else if (line.includes('[download] Destination')) {
          task.message = 'Preparing download...';
          task.emitter.emit('update');
        }
      });
    }

    if (subprocess.stderr) {
      subprocess.stderr.on('data', (data: Buffer) => {
        // Some warnings or status info might come in stderr, but mostly errors
        if (!data.toString().includes('WARNING')) {
            console.error('yt-dlp stderr:', data.toString());
        }
      });
    }

    await subprocess;
    
    // If it wasn't killed/paused
    if (task.status === 'downloading') {
        task.status = 'completed';
        task.progress = 100;
        task.message = 'Download completed successfully';
        task.emitter.emit('update');
        updateSessionFile(task.outputFolder, task);
    }
  } catch (error: any) {
    // If the error was caused by us killing the process (SIGINT), don't treat it as a real error
    if (task.status === 'paused' || task.status === 'pending') return;

    console.error('Download error:', error);
    task.status = 'error';
    task.message = error.message || 'An error occurred during download';
    task.emitter.emit('update');
    updateSessionFile(task.outputFolder, task);
  }
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
