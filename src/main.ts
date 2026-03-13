import "./style.css";
import { SelectionManager } from "./ui-utils.js";
import { EvaluationManager } from "./evaluation-manager.js";

export interface Point { x: number; y: number; }

export interface DetectedShape {
  type: "circle" | "triangle" | "rectangle" | "pentagon" | "star";
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  center: Point;
  area: number;
}

export interface DetectionResult {
  shapes: DetectedShape[];
  processingTime: number;
  imageWidth: number;
  imageHeight: number;
}

/*
Blob represents a connected component detected in the binary image.
Each blob corresponds to one potential shape.
*/
interface Blob {
  pixels: Point[];
  minX: number; maxX: number;
  minY: number; maxY: number;
}

export class ShapeDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  // MAIN SHAPE DETECTION PIPELINE
  // Steps:
  // 1. Convert image to grayscale
  // 2. Apply thresholding to separate foreground/background
  // 3. Remove noise using morphological operations
  // 4. Detect connected components (potential shapes)
  // 5. Classify each component using geometric features

 

  async detectShapes(imageData: ImageData): Promise<DetectionResult> {
    const startTime = performance.now();
    const { width, height, data } = imageData;

     /*
    STEP 1: Convert image to grayscale
    This simplifies the image so that intensity values
    represent brightness only.
    */
    const grey = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
      const alpha = a / 255;
      grey[i] = Math.round((0.299*r + 0.587*g + 0.114*b) * alpha + 255*(1-alpha));
    }

    //  STEP 2: Thresholding

    // Decide whether each pixel belongs to foreground (shape)
    // or background.

    // If image is very dark -> use adaptive threshold
    // otherwise simple global threshold works.
    // 

    let darkCount = 0;
    for (let i = 0; i < grey.length; i++) if (grey[i] < 180) darkCount++;
    const darkRatio = darkCount / (width * height);

    let binary: Uint8Array;
    if (darkRatio > 0.35) {
      binary = this.adaptiveThreshold(grey, width, height);
    } else {
      binary = new Uint8Array(width * height);
      for (let i = 0; i < grey.length; i++) binary[i] = grey[i] < 128 ? 1 : 0;
    }
     /*
    STEP 3: Morphological filtering

    Remove small noise and smooth the shapes
    using erosion followed by dilation.
    */

    const cleaned = this.morphDilate(this.morphErode(binary, width, height), width, height);
    const blobs = this.connectedComponents(cleaned, width, height);

    const shapes: DetectedShape[] = [];
    const minArea = Math.max(200, width * height * 0.002);

    for (const blob of blobs) {
      if (blob.pixels.length < minArea) continue;

      const bw = blob.maxX - blob.minX + 1;
      const bh = blob.maxY - blob.minY + 1;

      if (Math.min(bw, bh) / Math.max(bw, bh) < 0.15) continue;

      const shape = this.classifyBlob(blob, cleaned, width, height);
      if (shape) shapes.push(shape);
    }

    return {
      shapes,
      processingTime: performance.now() - startTime,
      imageWidth: width,
      imageHeight: height,
    };
  }
    
  //Load an image file into canvas and extract ImageData
  

  loadImage(file: File): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.ctx.drawImage(img, 0, 0);
        resolve(this.ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  //SHAPE CLssification
//  Each connected component is analyzed using geometric
//   properties to determine its shape type.

//   Features used:
//   - extent
//   - solidity
//   - circularity
//   - bounding box squareness
//   - vertex count (RDP simplification)

  
  private classifyBlob(blob: Blob, binary: Uint8Array, width: number, height: number): DetectedShape | null {

    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    if (bw < 5 || bh < 5) return null;

    const cx = (blob.minX + blob.maxX) / 2;
    const cy = (blob.minY + blob.maxY) / 2;

    const pixelCount = blob.pixels.length;
    const extent = pixelCount / (bw * bh);

    const bbSquareness = Math.min(bw, bh) / Math.max(bw, bh);

    const hull = this.convexHull(blob.pixels);
    const hullArea = this.polygonArea(hull);
    const solidity = hullArea > 0 ? pixelCount / hullArea : 1;

    const perim = this.borderPixelCount(blob, binary, width, height);
    const circularity = perim > 0 ? (4 * Math.PI * pixelCount) / (perim * perim) : 0;
  
    // Simplify hull using Ramer-Douglas-Peucker algorithm
    // to estimate number of vertices
    
    const eps = Math.max(2, Math.min(bw, bh) * 0.035);
    const simplified = this.rdpSimplify(hull, eps);
    const verts = simplified.length;

    let type: DetectedShape["type"];
    let confidence: number;

   // square / rectangle detection first
if (bbSquareness > 0.95 && extent > 0.80) {
  type = "rectangle";
  confidence = Math.min(0.99, extent * 0.6 + bbSquareness * 0.4);

// star detection
} else if (solidity < 0.80 && circularity < 0.60) {
  type = "star";
  confidence = Math.min(0.97, 0.5 + (0.75 - Math.min(solidity, 0.75)) * 2.5);
} else if (circularity > 1.15 && bbSquareness > 0.95) {
      type = "circle";
      confidence = Math.min(0.99, Math.min(circularity / 1.4, 1.0) * 0.6 + bbSquareness * 0.4);

    } else if (extent > 0.90 && solidity > 0.90) {
      type = "rectangle";
      confidence = Math.min(0.99, extent * 0.7 + solidity * 0.3);

    } else if (circularity > 0.95 && solidity > 0.90 && extent < 0.65) {
      type = "rectangle";
      confidence = Math.min(0.92, circularity * 0.5 + solidity * 0.5);

    } else if (extent < 0.62 && circularity < 0.95) {
      type = "triangle";
      confidence = Math.min(0.96, (1 - extent) * 0.6 + solidity * 0.4);

    } else {
      type = "pentagon";
      const vertScore = Math.max(0, 1 - Math.abs(verts - 5) / 4);
      confidence = Math.min(0.95, solidity * 0.3 + extent * 0.4 + vertScore * 0.3);
    }

    return {
      type,
      confidence: Math.max(0.4, Math.min(0.99, confidence)),
      boundingBox: { x: blob.minX, y: blob.minY, width: bw, height: bh },
      center: { x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10 },
      area: pixelCount,
    };
  }

  private adaptiveThreshold(grey: Uint8Array, width: number, height: number): Uint8Array {
    const binary = new Uint8Array(width * height);
    const half = Math.floor(Math.max(15, Math.min(width, height) / 8) / 2);
    const C = 8;

    const intg = new Float64Array((width + 1) * (height + 1));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        intg[(y+1)*(width+1)+(x+1)] =
          grey[y*width+x] +
          intg[y*(width+1)+(x+1)] +
          intg[(y+1)*(width+1)+x] -
          intg[y*(width+1)+x];
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x-half), y1 = Math.max(0, y-half);
        const x2 = Math.min(width-1, x+half), y2 = Math.min(height-1, y+half);
        const n = (x2-x1+1)*(y2-y1+1);

        const s = intg[(y2+1)*(width+1)+(x2+1)] -
                  intg[y1*(width+1)+(x2+1)] -
                  intg[(y2+1)*(width+1)+x1] +
                  intg[y1*(width+1)+x1];

        binary[y*width+x] = grey[y*width+x] < (s/n) - C ? 1 : 0;
      }
    }

    return binary;
  }

  private morphErode(b: Uint8Array, w: number, h: number): Uint8Array {
    const o = new Uint8Array(w * h);
    for (let y = 1; y < h-1; y++)
      for (let x = 1; x < w-1; x++)
        if (b[y*w+x] && b[(y-1)*w+x] && b[(y+1)*w+x] && b[y*w+x-1] && b[y*w+x+1])
          o[y*w+x] = 1;
    return o;
  }

  private morphDilate(b: Uint8Array, w: number, h: number): Uint8Array {
    const o = new Uint8Array(w * h);
    for (let y = 1; y < h-1; y++)
      for (let x = 1; x < w-1; x++)
        if (b[y*w+x] || b[(y-1)*w+x] || b[(y+1)*w+x] || b[y*w+x-1] || b[y*w+x+1])
          o[y*w+x] = 1;
    return o;
  }

  private connectedComponents(binary: Uint8Array, width: number, height: number): Blob[] {

    const visited = new Uint8Array(width * height);
    const blobs: Blob[] = [];

    for (let sy = 0; sy < height; sy++) {
      for (let sx = 0; sx < width; sx++) {

        const si = sy * width + sx;

        if (!binary[si] || visited[si]) continue;

        const pixels: Point[] = [];
        const q = [si];

        visited[si] = 1;

        let minX = sx, maxX = sx, minY = sy, maxY = sy;

        while (q.length) {

          const cur = q.pop()!;
          const cx = cur % width;
          const cy = (cur / width) | 0;

          pixels.push({ x: cx, y: cy });

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (const n of [cur-width, cur+width, cur-1, cur+1]) {

            if (n >= 0 && n < width*height && !visited[n] && binary[n]) {

              const nx = n % width;

              if (nx >= 0 && nx < width) {
                visited[n] = 1;
                q.push(n);
              }
            }
          }
        }

        blobs.push({ pixels, minX, maxX, minY, maxY });
      }
    }

    return blobs;
  }

  private borderPixelCount(blob: Blob, binary: Uint8Array, width: number, height: number): number {

    let n = 0;

    for (const { x, y } of blob.pixels) {

      if (
        y === 0 || binary[(y-1)*width+x] === 0 ||
        y === height-1 || binary[(y+1)*width+x] === 0 ||
        x === 0 || binary[y*width+(x-1)] === 0 ||
        x === width-1 || binary[y*width+(x+1)] === 0
      ) n++;
    }

    return n;
  }

  private convexHull(points: Point[]): Point[] {

    if (points.length < 3) return [...points];

    const pts = [...points].sort((a,b)=>a.x!==b.x?a.x-b.x:a.y-b.y);

    const cross = (o:Point,a:Point,b:Point)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);

    const lower:Point[]=[];

    for(const p of pts){
      while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop();
      lower.push(p);
    }

    const upper:Point[]=[];

    for(let i=pts.length-1;i>=0;i--){
      const p=pts[i];
      while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop();
      upper.push(p);
    }

    upper.pop();
    lower.pop();

    return lower.concat(upper);
  }

  private polygonArea(pts: Point[]): number {

    let a=0;

    for(let i=0;i<pts.length;i++){
      const j=(i+1)%pts.length;
      a+=pts[i].x*pts[j].y-pts[j].x*pts[i].y;
    }

    return Math.abs(a)/2;
  }

  private rdpSimplify(pts: Point[], eps: number): Point[] {

    if (pts.length <= 2) return pts;

    let maxD = 0, idx = 0;

    const a = pts[0];
    const b = pts[pts.length-1];

    for (let i = 1; i < pts.length-1; i++) {
      const d = this.ptLineDist(pts[i], a, b);
      if (d > maxD) { maxD = d; idx = i; }
    }

    if (maxD > eps) {
      const l = this.rdpSimplify(pts.slice(0, idx+1), eps);
      const r = this.rdpSimplify(pts.slice(idx), eps);
      return [...l.slice(0,-1), ...r];
    }

    return [a,b];
  }

  private ptLineDist(p:Point,a:Point,b:Point):number{

    const dx=b.x-a.x;
    const dy=b.y-a.y;

    const len2=dx*dx+dy*dy;

    if(len2===0) return Math.hypot(p.x-a.x,p.y-a.y);

    const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/len2;

    return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
  }
}
class ShapeDetectionApp {
  private detector: ShapeDetector;
  private imageInput: HTMLInputElement;
  private resultsDiv: HTMLDivElement;
  private testImagesDiv: HTMLDivElement;
  private evaluateButton: HTMLButtonElement;
  private evaluationResultsDiv: HTMLDivElement;
  private selectionManager: SelectionManager;
  private evaluationManager: EvaluationManager;

  constructor() {
    const canvas = document.getElementById("originalCanvas") as HTMLCanvasElement;
    this.detector = new ShapeDetector(canvas);

    this.imageInput = document.getElementById("imageInput") as HTMLInputElement;
    this.resultsDiv = document.getElementById("results") as HTMLDivElement;
    this.testImagesDiv = document.getElementById("testImages") as HTMLDivElement;
    this.evaluateButton = document.getElementById("evaluateButton") as HTMLButtonElement;
    this.evaluationResultsDiv = document.getElementById("evaluationResults") as HTMLDivElement;

    this.selectionManager = new SelectionManager();
    this.evaluationManager = new EvaluationManager(
      this.detector,
      this.evaluateButton,
      this.evaluationResultsDiv
    );

    this.setupEventListeners();
    this.loadTestImages().catch(console.error);
  }

  private setupEventListeners(): void {
    this.imageInput.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.processImage(file);
      }
    });

    this.evaluateButton.addEventListener("click", async () => {
      const selectedImages = this.selectionManager.getSelectedImages();
      await this.evaluationManager.runSelectedEvaluation(selectedImages);
    });
  }

  private async processImage(file: File): Promise<void> {
    try {
      this.resultsDiv.innerHTML = "<p>Processing...</p>";

      const imageData = await this.detector.loadImage(file);
      const results = await this.detector.detectShapes(imageData);

      this.displayResults(results);
    } catch (error) {
      this.resultsDiv.innerHTML = `<p>Error: ${error}</p>`;
    }
  }

  private displayResults(results: DetectionResult): void {
    const { shapes, processingTime } = results;

    let html = `
      <p><strong>Processing Time:</strong> ${processingTime.toFixed(2)}ms</p>
      <p><strong>Shapes Found:</strong> ${shapes.length}</p>
    `;

    if (shapes.length > 0) {
      html += "<h4>Detected Shapes:</h4><ul>";
      shapes.forEach((shape) => {
        html += `
          <li>
            <strong>${shape.type.charAt(0).toUpperCase() + shape.type.slice(1)}</strong><br>
            Confidence: ${(shape.confidence * 100).toFixed(1)}%<br>
            Center: (${shape.center.x.toFixed(1)}, ${shape.center.y.toFixed(1)})<br>
            Area: ${shape.area.toFixed(1)}px²
          </li>
        `;
      });
      html += "</ul>";
    } else {
      html += "<p>No shapes detected.</p>";
    }

    this.resultsDiv.innerHTML = html;
  }

  private async loadTestImages(): Promise<void> {
    try {
      const module = await import("./test-images-data.js");
      const testImages = module.testImages;
      const imageNames = module.getAllTestImageNames();

      let html =
        '<h4>Click to upload your own image or use test images for detection. Right-click test images to select/deselect for evaluation:</h4>' +
        '<div class="evaluation-controls">' +
        '<button id="selectAllBtn">Select All</button>' +
        '<button id="deselectAllBtn">Deselect All</button>' +
        '<span class="selection-info">0 images selected</span>' +
        '</div><div class="test-images-grid">';

      html += `
        <div class="test-image-item upload-item" onclick="triggerFileUpload()">
          <div class="upload-icon">📁</div>
          <div class="upload-text">Upload Image</div>
          <div class="upload-subtext">Click to select file</div>
        </div>
      `;

      imageNames.forEach((imageName) => {
        const dataUrl = testImages[imageName as keyof typeof testImages];
        const displayName = imageName
          .replace(/[_-]/g, " ")
          .replace(/\.(svg|png)$/i, "");

        html += `
          <div class="test-image-item"
               onclick="loadTestImage('${imageName}', '${dataUrl}')"
               oncontextmenu="toggleImageSelection(event, '${imageName}')">
            <img src="${dataUrl}" alt="${imageName}">
            <div>${displayName}</div>
          </div>
        `;
      });

      html += "</div>";
      this.testImagesDiv.innerHTML = html;

      this.selectionManager.setupSelectionControls();

      (window as any).loadTestImage = async (name: string, dataUrl: string) => {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], name, { type: "image/svg+xml" });

        const imageData = await this.detector.loadImage(file);
        const results = await this.detector.detectShapes(imageData);
        this.displayResults(results);
      };

      (window as any).toggleImageSelection = (
        event: MouseEvent,
        imageName: string
      ) => {
        event.preventDefault();
        this.selectionManager.toggleImageSelection(imageName);
      };

      (window as any).triggerFileUpload = () => {
        this.imageInput.click();
      };

    } catch {
      this.testImagesDiv.innerHTML =
        "<p>Test images not available. Run convert-svg-to-png.js</p>";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ShapeDetectionApp();
});
