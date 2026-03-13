# Shape Detection Challenge

## Overview

This project implements a geometric **shape detection system** using classical computer vision techniques.  
The goal is to analyze an image and detect geometric shapes including:

- Circle
- Triangle
- Rectangle
- Pentagon
- Star

The implementation is written in **TypeScript** and runs directly in the browser without using external computer vision libraries.

# Approach

The detection pipeline follows several stages of image processing and geometric analysis.

 1. Grayscale Conversion
The input image is first converted from RGB to grayscale to simplify intensity analysis.

Formula used:

gray = 0.299R + 0.587G + 0.114B

This reduces the complexity of processing while preserving shape boundaries.

---

 2. Thresholding

Pixels are separated into:

- Foreground (shape)
- Background

Two methods are used:

Global Threshold
Used when the image background is clean.

Adaptive Threshold
Used when the image contains more noise or darker regions.

This step converts the image into a binary image.


 3. Morphological Filtering

Noise and small artifacts are removed using morphological operations:

- **Erosion**
- **Dilation**

This improves shape boundaries and removes isolated pixels.

 4. Connected Component Detection

The binary image is scanned to find **connected pixel regions**.

Each connected region represents a **potential shape**.

A stack-based flood fill algorithm is used to group pixels into blobs.


 5. Feature Extraction

For each detected blob, several geometric features are computed:

 Bounding Box
Used to determine shape size and position.

 Area
Calculated as the number of pixels in the blob.

 Center
Computed as the center of the bounding box.

 Extent
Ratio of blob pixels to bounding box area.

extent = blob_pixels / bounding_box_area

 Solidity
Measures convexity of the shape.

solidity = blob_area / convex_hull_area

 Circularity
Helps detect circles.

circularity = (4π × area) / perimeter²

 Vertex Count
Convex hull is simplified using the **Ramer-Douglas-Peucker algorithm** to estimate polygon vertices.

 6. Shape Classification

Shapes are classified using the extracted features.

Examples:

- Circle
  - High circularity
  - Square bounding box

- Triangle
  - Low extent
  - Lower circularity

- Rectangle
  - High extent
  - High solidity

- Pentagon
  - Moderate extent
  - Vertex count ≈ 5

- Star
  - Low solidity
  - Concave shape

Performance

Typical processing time per image:

**0.5ms – 3ms**

This is well below the assignment requirement of **2000ms per image**.

---

# Precision Metrics

The implementation attempts to satisfy evaluation requirements:

- Bounding Box Accuracy
  Bounding box tightly encloses detected shape.

- Center Point Accuracy
  Center is computed from bounding box midpoint.

- Area Accuracy
  Area is calculated directly from pixel count.

- Confidence Score
  Confidence reflects how closely the blob matches geometric expectations.


# Technologies Used

- TypeScript
- HTML5 Canvas API
- Basic image processing techniques
- Computational geometry algorithms
- 

# Notes

- No external libraries such as OpenCV were used.
- All algorithms are implemented using browser-native APIs.
- The solution focuses on robustness across different shapes and image conditions.


# Author

Ayushman
