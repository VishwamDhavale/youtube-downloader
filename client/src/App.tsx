import React, { useState, useEffect } from 'react';
import { 
  Play, Download, List, Settings, Plus, Folder, 
  Info, Loader2, Pause, RotateCcw, XCircle, CheckCircle,
  Video, Music, Layers
} from 'lucide-react';
import './App.css';
interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string;
  vcodec: string;
  acodec: string;
  note: string;
  filesize?: number;
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface VideoMetadata {
  id: string;
  title: string;
  thumbnail: string;
  isPlaylist: boolean;
  duration: number;
  uploader: string;
  formats: VideoFormat[];
}

interface DownloadTask {
  id: string;
  url: string;
  title?: string;
  thumbnail?: string;
  progress: number;
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error';
  message: string;
}

function App() {
  const [activeView, setActiveView] = useState<'new' | 'list'>('new');
  const [url, setUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('');
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  const loadSessions = async () => {
    if (!outputFolder) return;
    try {
      const response = await fetch('http://localhost:3001/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      // Update tasks and merge with existing ones (prevent duplicates)
      setTasks(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const newTasks = data.filter((t: any) => !existingIds.has(t.id));
        return [...prev, ...newTasks];
      });
      
      if (data.length > 0) {
        alert(`Loaded ${data.length} tasks from session file.`);
      } else {
        alert('No saved sessions found in this folder.');
      }
    } catch (err: any) {
      alert('Failed to load sessions: ' + err.message);
    }
  };

  // Fetch info logic
  const fetchInfo = async () => {
    if (!url) return;
    setIsLoadingInfo(true);
    setMetadata(null);
    try {
      const response = await fetch('http://localhost:3001/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setMetadata(data);
      // Default selections
      if (data.isPlaylist) {
        setSelectedFormat('bestvideo+bestaudio/best');
      } else {
        setSelectedFormat('best');
      }
    } catch (err: any) {
      alert('Failed to fetch video info: ' + err.message);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const startDownload = async () => {
    if (!url || !outputFolder) return;
    try {
      const response = await fetch('http://localhost:3001/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url, 
          outputFolder, 
          format: selectedFormat,
          title: metadata?.title,
          thumbnail: metadata?.thumbnail
        }),
      });
      const { taskId } = await response.json();
      
      const newTask: DownloadTask = {
        id: taskId,
        url,
        title: metadata?.title || url,
        thumbnail: metadata?.thumbnail,
        progress: 0,
        status: 'pending',
        message: 'Initializing...'
      };
      
      setTasks(prev => [newTask, ...prev]);
      setActiveView('list');
      setupSSE(taskId);
      
      // Reset form
      setUrl('');
      setMetadata(null);
    } catch (err: any) {
      alert('Failed to start download: ' + err.message);
    }
  };

  const setupSSE = (taskId: string) => {
    const eventSource = new EventSource(`http://localhost:3001/api/progress/${taskId}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, ...data } : t
      ));
      if (data.status === 'completed' || data.status === 'error') {
        eventSource.close();
      }
    };
    eventSource.onerror = () => {
      eventSource.close();
    };
  };

  const handleAction = async (taskId: string, action: string) => {
    try {
      const response = await fetch('http://localhost:3001/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      });
      const data = await response.json();
      
      if (action === 'resume') {
        setupSSE(taskId);
      } else if (action === 'cancel') {
        setTasks(prev => prev.filter(t => t.id !== taskId));
      }
    } catch (err: any) {
      alert('Action failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Play fill="currentColor" size={24} />
          <span>YT Downloader</span>
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeView === 'new' ? 'active' : ''}`}
            onClick={() => setActiveView('new')}
          >
            <Plus size={20} /> New Download
          </button>
          <button 
            className={`nav-item ${activeView === 'list' ? 'active' : ''}`}
            onClick={() => setActiveView('list')}
          >
            <List size={20} /> Downloads ({tasks.length})
          </button>
          <button className="nav-item">
            <Settings size={20} /> Settings
          </button>
        </nav>
      </aside>

      <main className="main-content">
        {activeView === 'new' ? (
          <div className="view">
            <header className="view-header">
              <h1 className="view-title">Start a New Download</h1>
              <p className="text-secondary">Paste a YouTube URL to get started</p>
            </header>

            <div className="card">
              <div className="form-group">
                <label className="label">YouTube URL</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <input 
                    className="input" 
                    placeholder="https://www.youtube.com/watch?v=..." 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <button 
                    className="btn btn-primary" 
                    onClick={fetchInfo}
                    disabled={isLoadingInfo || !url}
                  >
                    {isLoadingInfo ? <Loader2 className="animate-spin" size={20} /> : <Info size={20} />}
                    Fetch Info
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="label">Output Folder</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <Folder 
                      size={18} 
                      style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} 
                    />
                    <input 
                      className="input" 
                      style={{ paddingLeft: '2.75rem' }}
                      placeholder="/home/user/Downloads" 
                      value={outputFolder}
                      onChange={(e) => setOutputFolder(e.target.value)}
                    />
                  </div>
                  <button 
                    className="btn btn-secondary" 
                    onClick={loadSessions}
                    disabled={!outputFolder}
                    title="Load previous downloads from this folder"
                  >
                    <RotateCcw size={20} />
                    Scan for Sessions
                  </button>
                </div>
              </div>

              {metadata && (
                <div className="info-display">
                  <img src={metadata.thumbnail} className="thumbnail" alt="thumbnail" />
                  <div className="video-meta">
                    <h2 className="video-title">{metadata.title}</h2>
                    <p className="text-secondary">{metadata.uploader} • {metadata.isPlaylist ? 'Playlist' : 'Video'}</p>
                    
                    <div className="form-group" style={{ marginTop: '1rem' }}>
                      <label className="label">
                        {metadata.isPlaylist ? 'Quality Preset' : 'Format / Quality'}
                      </label>
                      <select 
                        className="input select"
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat(e.target.value)}
                      >
                        {metadata.isPlaylist ? (
                          <>
                            <option value="bestvideo+bestaudio/best">Best Video + Audio</option>
                            <option value="bestaudio">Best Audio Only</option>
                            <option value="bestvideo[height<=1080]+bestaudio/best[height<=1080]">Full HD (1080p) Max</option>
                            <option value="bestvideo[height<=720]+bestaudio/best[height<=720]">HD (720p) Max</option>
                          </>
                        ) : (
                          <>
                            <option value="best">Best Quality (Auto)</option>
                            
                            {/* Video + Audio */}
                            <optgroup label="Video + Audio (High Quality)">
                              {metadata.formats
                                .filter(f => f.vcodec !== 'none') // Include both combined and video-only
                                .map(f => (
                                  <option key={f.formatId} value={f.formatId}>
                                    {f.resolution} {f.ext} ({f.note}) {f.filesize ? `~ ${formatBytes(f.filesize)}` : ''}
                                  </option>
                                ))}
                            </optgroup>

                            {/* Video Only */}
                            <optgroup label="Video Only">
                              {metadata.formats
                                .filter(f => f.vcodec !== 'none' && f.acodec === 'none')
                                .map(f => (
                                  <option key={f.formatId} value={f.formatId}>
                                    {f.resolution} {f.ext} ({f.note}) {f.filesize ? `~ ${formatBytes(f.filesize)}` : ''}
                                  </option>
                                ))}
                            </optgroup>

                            {/* Audio Only */}
                            <optgroup label="Audio Only">
                              {metadata.formats
                                .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
                                .map(f => (
                                  <option key={f.formatId} value={f.formatId}>
                                    {f.ext} ({f.note}) {f.filesize ? `~ ${formatBytes(f.filesize)}` : ''}
                                  </option>
                                ))}
                            </optgroup>
                          </>
                        )}
                      </select>
                    </div>

                    <button 
                      className="btn btn-primary" 
                      style={{ width: 'fit-content', marginTop: '1rem' }}
                      onClick={startDownload}
                    >
                      <Download size={20} /> Start Download
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="view">
            <header className="view-header">
              <h1 className="view-title">Downloads</h1>
              <p className="text-secondary">Manage your active and completed tasks</p>
            </header>

            <div className="download-list">
              {tasks.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '4rem' }}>
                  <Layers size={48} style={{ color: '#d1d5db', marginBottom: '1rem' }} />
                  <p className="text-secondary">No active downloads yet</p>
                </div>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="card download-card">
                    {task.thumbnail ? (
                      <img src={task.thumbnail} style={{ width: '120px', borderRadius: '0.375rem' }} alt="" />
                    ) : (
                      <div style={{ width: '120px', aspectRatio: '16/9', background: '#f3f4f6', borderRadius: '0.375rem', display: 'flex', alignItems: 'center', justifySelf: 'center' }}>
                        <Video size={24} style={{ margin: 'auto', color: '#9ca3af' }} />
                      </div>
                    )}
                    
                    <div className="progress-container">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.925rem' }} className="truncate">
                          {task.title}
                        </span>
                        <span className={`status-badge status-${task.status}`}>
                          {task.status}
                        </span>
                      </div>
                      <p className="text-secondary" style={{ fontSize: '0.8125rem', marginBottom: '0.5rem' }}>
                        {task.message}
                      </p>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {task.status === 'downloading' || task.status === 'pending' ? (
                        <button 
                          className="btn btn-secondary btn-icon" 
                          title="Pause"
                          onClick={() => handleAction(task.id, 'pause')}
                        >
                          <Pause size={18} />
                        </button>
                      ) : (task.status === 'paused' || task.status === 'error') ? (
                        <button 
                          className="btn btn-secondary btn-icon" 
                          title="Resume"
                          onClick={() => handleAction(task.id, 'resume')}
                        >
                          <RotateCcw size={18} />
                        </button>
                      ) : null}
                      
                      <button 
                        className="btn btn-secondary btn-icon" 
                        title="Remove"
                        onClick={() => handleAction(task.id, 'cancel')}
                        style={{ color: '#ef4444' }}
                      >
                        <XCircle size={18} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
