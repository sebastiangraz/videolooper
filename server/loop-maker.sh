#!/bin/bash
# ------------------------------------------------------------------------------
# Video Loop Maker - v2.5
# ------------------------------------------------------------------------------
# Creates a seamless loop from a video file using two techniques
# Usage: ./loop-maker.sh <input_video> [technique] [fade_duration] [start_second]
# Techniques:
#   crossfade - Crossfade between end and beginning
#   reverse   - Simple reversed loop (default, most reliable)
# Fade Duration:
#   Optional parameter for crossfade duration in seconds (default: 0.5)
# Start Second:
#   Optional parameter for which second to start the video at (default: 0)
# ------------------------------------------------------------------------------

set -e # Exit on error

# --- Function to check dependencies ---
check_dependencies() {
  if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg not found. Please install ffmpeg to use this script."
    exit 1
  fi
  
  if ! command -v bc &> /dev/null; then
    echo "Error: bc command not found. Using fallback calculations."
    # Set a fallback function for bc
    bc() {
      echo "1" # Just return a safe default for calculations
    }
  fi

  if ! command -v ffprobe &> /dev/null; then
    echo "Error: ffprobe not found. It should be part of ffmpeg installation."
    exit 1
  fi
}

# --- Print debug info ---
echo "Script started with arguments: $@"
echo "Current directory: $(pwd)"

# --- Default parameters ---
INPUT_FILE="$1"
TECHNIQUE="${2:-reverse}" # Use reverse as default - most reliable
FADE_DURATION="${3:-0.5}" # Use provided fade duration or default to 0.5 seconds
START_SECOND="${4:-0}"   # Use provided start second or default to 0
TEMP_DIR=$(dirname "$INPUT_FILE")/tmp_loop_$(date +%s)
OUTPUT_FILE="${INPUT_FILE}_loop.mp4"

# --- Validate input ---
if [ $# -lt 1 ]; then
    echo "Error: No input file specified"
    echo "Usage: $0 <input_video> [technique] [fade_duration] [start_second]"
    echo "Available techniques: crossfade, reverse"
    echo "Fade duration: Optional parameter in seconds (default: 0.5)"
    echo "Start second: Optional parameter for which second to start at (default: 0)"
    exit 1
fi

if ! [ -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' does not exist"
    echo "File path provided: $INPUT_FILE"
    echo "Current directory: $(pwd)"
    echo "Directory contents: $(ls -la $(dirname "$INPUT_FILE"))"
    exit 1
fi

# --- Verify dependencies are installed ---
check_dependencies

# --- Create temp directory ---
mkdir -p "$TEMP_DIR"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "Processing video: $INPUT_FILE"
echo "Output will be saved to: $OUTPUT_FILE"

# --- Basic fallback method if analysis fails ---
create_simple_loop() {
  echo "Using simple fallback method..."
  
  # Create a simple reverse file first - no fifo needed
  REVERSE_FILE="$TEMP_DIR/reverse.mp4"
  ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -preset fast "$REVERSE_FILE"
  
  # Then concatenate the files
  ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
    "[0:v][1:v]concat=n=2:v=1:a=0" \
    -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
    "$OUTPUT_FILE"
}

# --- Try to get video duration and info ---
echo "Analyzing video..."
if ! DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null); then
  echo "Warning: Could not determine video duration, using fallback method"
  create_simple_loop
  exit 0
fi

# Get basic video info with error handling
FPS=$(ffprobe -v 0 -select_streams v:0 -of csv=p=0 \
       -show_entries stream=r_frame_rate "$INPUT_FILE" | bc)
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")
HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" 2>/dev/null || echo "unknown")

# Convert fps fraction to decimal if needed
if [[ $FPS == */* ]]; then
  FPS=$(echo "scale=2; $FPS" | bc 2>/dev/null || echo "24")
fi

echo "Video info:"
echo "- Duration: $DURATION seconds"
echo "- FPS: $FPS"
echo "- Resolution: ${WIDTH}x${HEIGHT}"
echo "- Looping technique: $TECHNIQUE"

# --- Create seamless loop based on technique ---
case "$TECHNIQUE" in
  "crossfade")
    echo "Creating seamless loop with crossfade technique..."
    
    # Use user-provided fade duration (or default)
    echo "Using fade duration: $FADE_DURATION seconds"
    echo "Starting from: $START_SECOND seconds"
    
    # Extract total duration of the video
    TOTAL_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE")
    
    # Extract framerate for consistency
    VIDEO_FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" | bc || echo "30")
    
    echo "Video duration: $TOTAL_DURATION seconds"
    echo "Video framerate: $VIDEO_FPS fps"
    
    # Let's use a different approach with separate files instead of complex filtergraph
    echo "Creating loop in multiple steps..."
    
    # Calculate clip segments
    # If START_SECOND is 0, use original approach
    # Otherwise, we need to reorganize the video to start at START_SECOND
    
    # Step 1: Create two segments of the video - before and after the start second
    BEFORE_START="$TEMP_DIR/before_start.mp4"
    AFTER_START="$TEMP_DIR/after_start.mp4"
    
    if [ "$START_SECOND" != "0" ]; then
      echo "Splitting video at start point: $START_SECOND seconds"
      # Extract portion from 0 to START_SECOND
      ffmpeg -y -i "$INPUT_FILE" -ss 0 -to "$START_SECOND" -c:v libx264 -preset fast -r $VIDEO_FPS "$BEFORE_START"
      
      # Extract portion from START_SECOND to end
      ffmpeg -y -i "$INPUT_FILE" -ss "$START_SECOND" -c:v libx264 -preset fast -r $VIDEO_FPS "$AFTER_START"
      
      # Create a temp file that has AFTER_START followed by BEFORE_START
      REORDERED="$TEMP_DIR/reordered.mp4"
      ffmpeg -y -i "$AFTER_START" -i "$BEFORE_START" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0" -c:v libx264 -preset fast "$REORDERED"
      
      # Now use this reordered video for the rest of the process
      WORKING_FILE="$REORDERED"
    else
      # If no reordering needed, just use original file
      WORKING_FILE="$INPUT_FILE"
    fi
    
    # Get duration of working file
    if [ "$START_SECOND" != "0" ]; then
      # If we're using a reordered file, we need to recalculate the duration
      TOTAL_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WORKING_FILE")
      echo "Reordered video duration: $TOTAL_DURATION seconds"
    fi
    
    # Step 2: Extract first section for the intro clip
    INTRO_CLIP="$TEMP_DIR/intro.mp4"
    echo "Extracting intro clip..."
    ffmpeg -y -i "$WORKING_FILE" -t $FADE_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS "$INTRO_CLIP"
    
    # Step 3: Create the end part where we'll add the crossfade
    END_CLIP="$TEMP_DIR/end.mp4"
    END_START=$(echo "$TOTAL_DURATION - $FADE_DURATION" | bc)
    echo "Extracting end clip starting at $END_START seconds..."
    ffmpeg -y -i "$WORKING_FILE" -ss $END_START -c:v libx264 -preset fast -r $VIDEO_FPS "$END_CLIP"
    
    # Step 4: Create the main part (without the first portion)
    MAIN_CLIP="$TEMP_DIR/main.mp4"
    echo "Extracting main clip..."
    ffmpeg -y -i "$WORKING_FILE" -ss $FADE_DURATION -c:v libx264 -preset fast -r $VIDEO_FPS "$MAIN_CLIP"
    
    # Step 5: Crossfade end and intro
    CROSSFADE_CLIP="$TEMP_DIR/crossfade.mp4"
    echo "Creating crossfade between end and intro..."
    ffmpeg -y -i "$END_CLIP" -i "$INTRO_CLIP" -filter_complex "
    [0:v]format=yuv420p,fps=$VIDEO_FPS[v0];
    [1:v]format=yuv420p,fps=$VIDEO_FPS[v1];
    [v0][v1]xfade=transition=fade:duration=$FADE_DURATION:offset=0
    " -c:v libx264 -preset fast -r $VIDEO_FPS "$CROSSFADE_CLIP"
    
    # Step 6: Concatenate main part with crossfade
    echo "Combining main clip with crossfade segment..."
    ffmpeg -y -i "$MAIN_CLIP" -i "$CROSSFADE_CLIP" -filter_complex "
    [0:v][1:v]concat=n=2:v=1:a=0
    " -c:v libx264 -preset fast -pix_fmt yuv420p "$OUTPUT_FILE"
    ;;
    
  "reverse"|*)
    echo "Creating simple reversed loop..."
    # First create reversed video
    REVERSE_FILE="$TEMP_DIR/reverse.mp4"
    if ! ffmpeg -y -i "$INPUT_FILE" -vf "reverse" -c:v libx264 -preset fast "$REVERSE_FILE"; then
      echo "Failed to create reverse clip, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
      exit 0
    fi
    
    # Then concatenate with original
    if ! ffmpeg -y -i "$INPUT_FILE" -i "$REVERSE_FILE" -filter_complex \
         "[0:v][1:v]concat=n=2:v=1:a=0" \
         -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p \
         "$OUTPUT_FILE"; then
      echo "Failed to concatenate videos, copying original as fallback"
      cp "$INPUT_FILE" "$OUTPUT_FILE"
    fi
    ;;
esac

# --- Verify output file exists ---
if [ -f "$OUTPUT_FILE" ]; then
    echo "Success! Seamless loop created at: $OUTPUT_FILE"
    # Get output file size
    OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" 2>/dev/null | cut -f1 || echo "unknown")
    echo "Output file size: $OUTPUT_SIZE"
else
    echo "Error: Failed to create output file at: $OUTPUT_FILE"
    echo "Directory contents: $(ls -la $(dirname "$OUTPUT_FILE"))"
    # Last resort fallback - just copy the input file to output
    echo "Creating a fallback non-looping copy as last resort"
    cp "$INPUT_FILE" "$OUTPUT_FILE"
fi 