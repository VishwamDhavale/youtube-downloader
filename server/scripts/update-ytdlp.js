import { execFileSync } from 'child_process';
import youtubeDl from 'youtube-dl-exec';

try {
  console.log('Updating yt-dlp binary...');
  // The youtube-dl-exec wrapper exports the binary path in its constants
  const binaryPath = youtubeDl.constants.YOUTUBE_DL_PATH;
  execFileSync(binaryPath, ['-U'], { stdio: 'inherit' });
  console.log('Update complete!');
} catch (error) {
  console.error('Failed to update yt-dlp:', error.message);
  process.exit(1);
}
