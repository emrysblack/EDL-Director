# EDL-Director

![build workflow](https://github.com/emrysblack/EDL-Director/actions/workflows/build.yml/badge.svg)

EDL Director is an application designed to take an [EDL file](http://www.mplayerhq.hu/DOCS/HTML/en/edl.html), and apply changes to
a corresponding video file allowing easy changes to a video. Muting and skipping are supported.

This can be useful for doing things such as removing commercial breaks, muting loud
noises or undesired language etc.

As right now few video players actually support [EDL files](http://www.mplayerhq.hu/DOCS/HTML/en/edl.html), this application is useful
to make an edited file that will playback on any player that would read the original.

To get started, head on over to the [releases page](https://github.com/emrysblack/EDL-Director/releases) and download the desired version for your system.  
*Alternatively, you could download the source and build it yourself if you feel comfortable with that (You'll need a recent version of Node.js and NPM).*  

You'll also need an EDL file. These you can create yourself following the simple format detailed [here](http://www.mplayerhq.hu/DOCS/HTML/en/edl.html),
or you can use a pre-existing EDL if you know where to get one. As people have different tastes and needs, I suggest making your own as it's easy enough.  
You can also use a tool like [FilterFlix](https://www.filterflix.com/) to generate one for you to start from if you have a subtitle file and want to filter
profanity out of a video.

After you've got those things, just run the application, open the video file you want to edit and the edl with the changes (EDL will automatically open if named to match the video and they reside in same folder. E.G. sample.mp4 and sample.edl).

You can preview any edl filters before saving the new video. This will allow you to fine-tune your filters before saving to a new file.

Other than that, I hope you enjoy :)

### Aditional Notes ###
The default functionality should take care of 90% of regular users' use cases (or at least mine), there are some additional thoughts for those extra ones.

This tool will match the file format of the input. So if you have an mp4, you'll get an mp4 back. MKV will give you back an MKV. If you want to change the encoding or container format, it is suggested to use this tool first, and then put the resulting video through something like [Handbrake](https://handbrake.fr/) (or your video tool of choice) to get it just how you like it.  

As of right now, this will only output a video with a single audio stream, all other attachments, data, subtitles, chapter markers are stripped out. There is a plan for some of these in the future, but you'll have to be patient. If you need these extras, there are plenty of free tools such as MKVToolnix (assuming you have an MKV file) that will allow you to add them back in to the finished video.

There is a **remux mode** for more advanced/picky users. If you are familiar with video editing this might interest you as it can make video cuts without re-encoding the video. It is experimental right now as not all codecs are supported. Also, all cuts will happen on keyframes in this mode as cutting between keyframes requires a video encode, so your cut filters may be off by a little bit (unless the cuts are happening directly on a keyframe), but you still have a preview button to ease your pain. Any mute filter require a re-encode of the audio (not the video) so those are unaffected by remux mode. Apart from that remember that remux mode is experimental, so be kind while we work out the kinks together :)  
If you can't get the cut you want in remux mode, just turn it off and use the default mode which will make accurate cuts. And if you just can't stand the thought of re-encoding your precious videos because you're a purist, I can't imagine you would be interested in a tool like this anyway as it's designed to modify your precious vids.

#### Feeling Generous? ####
Small thanks are always appreciated. I do have a full-time job that keeps me busy (as do we all), but I like to develop things like this when I can. Send a "hello" to me on the forums, or give something small under the "Sponsor this project" section on the right side of the page. It helps me know my work is appreciated and that I should keep the updates coming for all you awesome folks :)
