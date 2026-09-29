/**
 * This class handles data visualization
 */
export class Graph {
    constructor() {
        this.canvas = document.getElementById("graph");

        // Set canvas inner width and height
        // to match width and height defined in css file
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;

        this.rect = this.canvas.getBoundingClientRect();

        this.ctx = this.canvas.getContext("2d");

        // Values used for rendering positions
        this.padding = 50;
        this.stepX = 0;

        // Values used to store received data
        // because we will use them later for redrawing canvas
        this.labels = null;
        this.data = null;
        this.currency = null;

        // Limit of labels to show
        this.labelCount = 6;

        // Used to check, if we need to show
        // specific currency data in the graph
        this.showExtraData = false;

        // Subscribing to resize event, so we could
        // redraw entire graph when screen size changes
        window.onresize = () => this.resize();

        // Subscribing to mouseenter event
        // to let canvas know, when to show extra data
        this.canvas.addEventListener("mouseenter", () => {
            this.showExtraData = true;
        });

        // Subscribing to mouseleave event
        // to let canvas know, when to stop showing extra data
        this.canvas.addEventListener("mouseleave", () => this.hideExtraData());

        // Show extra data for each new position
        this.canvas.addEventListener("mousemove", (e) => this.showData(e));

        // Touch equivalents - mouseenter/mousemove/mouseleave never fire
        // from touch interaction, so hovering the line chart never worked
        // on touch devices at all (unlike the candle view, where
        // Lightweight Charts handles this itself). A tap-and-drag shows
        // the crosshair immediately and tracks the finger; lifting hides
        // it again, mirroring mouseenter/mousemove/mouseleave.
        // preventDefault (backed by touch-action: none in CSS on #graph)
        // stops the drag from scrolling the page instead of moving the
        // crosshair - the same class of fix already applied to the candle
        // chart's container.
        this.canvas.addEventListener(
            "touchstart",
            (e) => {
                this.showExtraData = true;
                this.showData(e);
                e.preventDefault();
            },
            { passive: false }
        );

        this.canvas.addEventListener(
            "touchmove",
            (e) => {
                this.showData(e);
                e.preventDefault();
            },
            { passive: false }
        );

        this.canvas.addEventListener("touchend", () => this.hideExtraData());
    }

    hideExtraData() {
        this.showExtraData = false;

        // Nothing to redraw if the initial data load never succeeded
        if (this.data != null && this.labels != null) {
            this.drawClient(this.data, this.labels, this.currency);
        }
    }

    /**
    * Resizes the canvas buffer to match its current on-screen size and
    * redraws. Also called explicitly (not just on window resize) when the
    * line view is unhidden, since its size can go stale while hidden
    * (display:none reports clientWidth/Height as 0) and no resize event
    * fires just from toggling visibility.
    */
    resize() {
        // Nothing to size to while hidden (display:none) - bail out rather
        // than shrinking the canvas buffer to 0x0
        if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) {
            return;
        }

        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;

        // Change limit, because labels
        // start to collapse on each other
        if (this.canvas.width < 550) {
            this.labelCount = 3;
        } else {
            this.labelCount = 6;
        }

        this.rect = this.canvas.getBoundingClientRect();

        if (this.data != null && this.labels != null) {
            this.drawClient(this.data, this.labels, this.currency);
        }
    }

    /**
    * Shows extra data, when mouse is hovering over
    * one of the rendered data points
    */
    showData(e) {
        if (this.showExtraData && this.data != null && this.labels != null) {
            // Touch events carry position in e.touches[0], not e.clientX
            let clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
            let x = clientX - this.padding - this.rect.left;
            let y = this.canvas.height - this.padding;

            // A single-point chart has nothing to distinguish by X position
            // - drawClient's stepX guard forces stepX to 1 for it (to avoid
            // dividing by zero), which otherwise shrinks the "hit zone" for
            // dataIndex === 0 to a ~1px sliver right at the padding offset
            // instead of the whole canvas, so hovering anywhere else (e.g.
            // dead center, where a real hover naturally lands) would never
            // show the crosshair at all.
            let dataIndex = this.data.length === 1 ? 0 : Math.round(x / this.stepX);

            if (dataIndex >= 0 && dataIndex < this.data.length) {
                this.drawClient(this.data, this.labels, this.currency);

                let x = dataIndex * this.stepX + this.padding;

                this.drawLine(x, this.padding, x, y, "black");
                this.drawText(
                    x,
                    0,
                    100,
                    50,
                    `${this.data[dataIndex]} ${this.currency}`,
                    new Date(this.labels[dataIndex]).toUTCString(),
                    "white"
                );
            }
        }
    }

    drawText(x, y, width, height, text, dateText, color) {
        let metrics = this.ctx.measureText(dateText);

        // Recalculate position if current dateText
        // goes out of bounds
        if (metrics.width + x >= this.canvas.width) {
            x = this.canvas.width - metrics.width;
        }

        this.ctx.fillStyle = "black";
        this.ctx.fillText(text, x, height - 30);
        this.ctx.fillText(dateText, x, height - 10);
    }

    drawLine(x1, y1, x2, y2, color) {
        this.ctx.beginPath();

        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);

        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    fillRect(rect, color) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    drawClient(data, labels, currency) {
        // Saving given values
        this.data = data;
        this.labels = labels;
        this.currency = currency;

        // Drawing background
        this.fillRect(
            { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height },
            "white"
        );

        // Apply padding to all values
        let startX = this.padding;
        let startY = this.padding;
        let graphWidth = this.canvas.width - this.padding * 2;
        let graphHeight = this.canvas.height - this.padding * 2;

        // Find grid increment values
        this.stepX = Math.round(graphWidth / (labels.length - 1));
        let stepY = graphHeight / 4;

        // Can not be less than one pixel. A single data point divides by
        // zero here (labels.length - 1 === 0), leaving stepX as Infinity -
        // "< 1" doesn't catch that (Infinity < 1 is false), and it would
        // otherwise propagate into dataIndex * Infinity = NaN coordinates
        // in showData, silently no-op'ing the hover crosshair entirely
        // (non-finite coordinates are a spec'd no-op for canvas draw calls).
        if (!Number.isFinite(this.stepX) || this.stepX < 1) {
            this.stepX = 1;
        }

        let maxY = Math.max(...this.data);
        let minY = Math.min(...this.data);

        let diff = maxY - minY;

        // Decreasing max value and treating
        // min value as 0 (for rendering purposes)
        maxY -= minY;

        // Drawing graph backgroud
        this.fillRect(
            { x: startX, y: startY, w: graphWidth, h: graphHeight },
            "white"
        );

        this.drawGrid(
            startX,
            startY,
            graphWidth,
            graphHeight,
            this.stepX,
            stepY,
            labels.length - 1
        );

        this.drawLabels(
            labels,
            startX,
            this.stepX,
            stepY,
            minY,
            diff,
            graphHeight
        );

        this.drawGraph(
            data,
            startX,
            startY,
            maxY,
            minY,
            labels.length,
            this.stepX,
            graphHeight
        );
    }

    drawLabels(
        labels,
        startX,
        stepX,
        stepY,
        minY,
        diff,
        graphHeight,
        color = "black"
    ) {
        this.ctx.fillStyle = color;
        this.ctx.font = "12px Inter";

        // Calculating nth value to find which label to render
        // from the whole list of labels
        let step = Math.round(labels.length / this.labelCount);

        let metrics;
        let x = startX;

        for (let i = 0; i < labels.length; i++) {
            if ((i !== 0 && i % step == 0) || i == 0) {
                metrics = this.ctx.measureText(labels[i]);
                this.ctx.fillText(
                    labels[i],
                    startX - metrics.width / 2,
                    this.canvas.height
                );
            }

            startX += stepX;
        }

        let startY = this.padding + graphHeight;
        let offset = 0;

        for (let i = 0; i < 5; i++) {
            this.ctx.fillText((minY + offset).toFixed(4), 0, startY + 6);

            offset = ((i + 2) * diff) / 5;

            startY -= stepY;
        }
    }

    drawGrid(x, y, width, height, stepX, stepY, count, color = "#b8c8cf") {
        this.ctx.beginPath();
        // let startX = x;

        // for (let i = 0; i < count + 1; i++) {
        //     // this.ctx.moveTo(startX, y);
        //     // this.ctx.lineTo(startX, height + this.padding);

        //     startX += stepX;
        // }

        let startY = this.padding;

        for (let i = 0; i < 5; i++) {
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(width + this.padding * 2, startY);

            startY += stepY;
        }

        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }

    drawGraph(
        data,
        startX,
        startY,
        maxY,
        minY,
        count,
        stepX,
        height,
        color = "blue"
    ) {
        this.ctx.beginPath();

        for (let i = 1; i < count; i++) {
            let y1 =
                height -
                Math.round(((this.data[i - 1] - minY) * height) / maxY) +
                this.padding;
            let y2 =
                height -
                Math.round(((this.data[i] - minY) * height) / maxY) +
                this.padding;

            this.ctx.moveTo(startX, y1);
            this.ctx.lineTo(startX + stepX, y2);

            startX += stepX;
        }

        this.ctx.strokeStyle = color;
        this.ctx.stroke();
    }
}
