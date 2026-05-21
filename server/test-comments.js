import pkg from 'youtube-dl-exec';
const youtubedl = pkg;

async function test() {
  try {
    const output = await youtubedl('https://www.youtube.com/watch?v=jNQXAC9IVRw', {
      dumpSingleJson: true,
      writeComments: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });
    console.log("Output has comments:", !!output.comments);
    if (output.comments && output.comments.length > 0) {
      console.log("First comment:", output.comments[0].text);
      console.log("Comment count:", output.comment_count);
    }
  } catch (err) {
    console.error(err);
  }
}
test();
