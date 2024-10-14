document.addEventListener("DOMContentLoaded", () => {
    const blockName = document.querySelector("#texture-name");
    const blockSearch = document.querySelector("#texture-search");

    const getBlock = () => blockName.value.toLowerCase().trim().replace(/\s+/, "_");

    let isMultipart = false;
    document.querySelector("#block-select").onclick = async () => {
        isMultipart = false;
        const data = await fetch(`../minecraft/blockstates/${getBlock()}.json`)
            .then(res => res.json())
            .catch(err => console.error(err));


        const variantCategories = {};
        if ("multipart" in data) {
            isMultipart = true;
            for (const part of data.multipart) {
                const conditional = part.when;
                if(!("when" in part)) {
                    continue;
                }
                
                if ("OR" in conditional || "AND" in conditional) {
                    for (const conditionalPart of conditional.OR ?? conditional.AND) {
                        for (const conditionalCategory of Object.keys(conditionalPart)) {
                            if (!(conditionalCategory in variantCategories)) {
                                variantCategories[conditionalCategory] = new Set();
                            }

                            for (const conditionalOption of conditionalPart[conditionalCategory].split("|")) {
                                variantCategories[conditionalCategory].add(conditionalOption);
                            }
                        }
                    }
                } else {
                    for (const conditionalCategory of Object.keys(conditional)) {
                        if (!(conditionalCategory in variantCategories)) {
                            variantCategories[conditionalCategory] = new Set();
                        }

                        for (const conditionalOption of conditional[conditionalCategory].split("|")) {
                            variantCategories[conditionalCategory].add(conditionalOption);
                        }
                    }
                }
            }
        } else {
            for (const key of Object.keys(data.variants)) {
                if (key == "") {
                    continue;
                }

                for (const categoryEntry of key.split(",")) {
                    const [category, value] = categoryEntry.split("=");
                    if (!(category in variantCategories)) {
                        variantCategories[category] = new Set();
                    }

                    variantCategories[category].add(value);
                }
            }
        }

        createOptions(variantCategories, "multipart" in data);
        blockSearch.hidden = false;
        document.querySelector("#state-label").hidden = false;
    };

    const variantSelector = document.querySelector("#variant-selector");
    blockSearch.onclick = async () => {
        const variantObj = {};
        if (variantSelector.querySelector("#no-variants") == null) {
            for (const listItem of variantSelector.children) {
                variantObj[listItem.firstChild.innerText] = listItem.lastChild.value;
            }
        }

        const result = await findTexturesFor(getBlock(), variantObj);

        document.querySelector("#block-result-label").hidden = false;
        console.log(result);

        document.querySelector("#model-images-label").hidden = false;

        let modelResults;
        if (isMultipart) { // Handle blocks made up of multiple subcomponents that can be toggled based on blockstate
            let parts = [];

            for (const entry of result) {
                parts.push(getBlockTextures(entry.model));
                // TODO: Also use block xRot, yRot, and uvlock in getblockTextures
            }

            modelResults = await Promise.all(parts);
        } else if (result instanceof Array) { // Handle blocks with randomly selected textures
            let calc = [];
            let weights = [];

            for (const entry of result) {
                calc.push(getBlockTextures(entry.value.model));
                // TODO: Also use block xRot, yRot, and uvlock in getblockTextures
                weights.push(entry.weight);
            }

            calc = await Promise.all(calc);
            modelResults = calc.map((v, i) => ({ value: v, weight: weights[i] }));
        } else { // Handle boring simple blocks
            modelResults = await getBlockTextures(result.model);
            // TODO: Also use block xRot, yRot, and uvlock in getblockTextures
        }

        const container = document.querySelector("#canvas-list");
        container.innerHTML = "";

        if(isMultipart) {
            for(const multipartSegment of modelResults) {
                const subContainer = document.createElement("div");
                subContainer.classList.add("multipart-segment");

                for (const cuboid of multipartSegment) {
                    subContainer.appendChild(annotateCuboidData(cuboid));
                }

                container.appendChild(subContainer);
            }
        } else {
            for (const cuboid of modelResults) {
                container.appendChild(annotateCuboidData(cuboid));
            }
        }

        console.log(modelResults);
    }
});

function formatNumericArray(arr, maxLength) {
    return arr.map(num => {
        const strNum = String(num);
        return strNum.padStart(maxLength, '0');
    }).join(', ');
}

function prettifyJson(jsonString, maxLength) {
    return jsonString.replace(/(\[)([^\[\]]*)(\])/g, (match, p1, p2, p3) => {
        const items = p2.split(',').map(item => item.trim());
        if (items.every(item => !isNaN(item))) {
            const numbers = items.map(Number);
            const formattedArray = formatNumericArray(numbers, maxLength);
            return `${p1}${formattedArray}${p3}`; // Return the formatted numeric array
        }
        return match; // Leave other arrays untouched
    });
}

function createOptions(blockStateVariants, includeUnknownOption = false) {
    const list = document.querySelector("#variant-selector");
    list.innerHTML = "";

    for (let stateType of Object.keys(blockStateVariants)) {
        const listEntryLabel = document.createElement("label");
        listEntryLabel.innerText = stateType;
        const listEntry = document.createElement("select");
        const collect = document.createElement("div");
        collect.appendChild(listEntryLabel);
        collect.appendChild(listEntry);
        collect.className = "variant-category";

        for (let stateValue of blockStateVariants[stateType]) {
            const valueOption = document.createElement("option");
            valueOption.value = stateValue;
            valueOption.innerHTML = stateValue;
            listEntry.appendChild(valueOption);
        }

        if (includeUnknownOption) {
            const valueOption = document.createElement("option");
            valueOption.value = "other";
            valueOption.innerHTML = "other";
            listEntry.appendChild(valueOption);
        }

        list.appendChild(collect);
    }

    if (list.children.length === 0) {
        const noMessage = document.createElement("h6");
        noMessage.id = "no-variants";
        noMessage.innerText = "This block has no blockstates";
        list.appendChild(noMessage);
    }
}

const canvasScale = 16;
function createCanvasFromRGBAData(data, width, height) {
    if (width * height !== data.length) {
        console.error(`${width} * ${height} !== ${data.length}`);
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.classList.add("block-texture");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(width, height);

    for (let i = 0; i < data.length; i++) {
        imgData.data[i * 4 + 0] = data[i][0];
        imgData.data[i * 4 + 1] = data[i][1];
        imgData.data[i * 4 + 2] = data[i][2];
        imgData.data[i * 4 + 3] = data[i][3];
    }
    ctx.putImageData(imgData, 0, 0);

    const newCanvas = document.createElement("canvas");
    newCanvas.classList.add("block-texture");
    newCanvas.width = width * canvasScale;
    newCanvas.height = height * canvasScale;
    const newCtx = newCanvas.getContext("2d");
    newCtx.webkitImageSmoothingEnabled = false;
    newCtx.mozImageSmoothingEnabled = false;
    newCtx.imageSmoothingEnabled = false;
    newCtx.scale(canvasScale, canvasScale);
    newCtx.drawImage(canvas, 0, 0);
    return newCanvas;
}

function createAnimationFromRGBAData(data, width, height, interpolated) {
    if (!data.every(v => v.pixels.length == width * height)) {
        console.error(`At least one animation frame has length !== ${width} * ${height} .`);
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.classList.add("block-texture");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    const newCanvas = document.createElement("canvas");
    newCanvas.classList.add("block-texture");
    newCanvas.width = width * canvasScale;
    newCanvas.height = height * canvasScale;
    const newCtx = newCanvas.getContext("2d");
    newCtx.webkitImageSmoothingEnabled = false;
    newCtx.mozImageSmoothingEnabled = false;
    newCtx.imageSmoothingEnabled = false;
    newCtx.scale(canvasScale, canvasScale);

    const imgData = ctx.createImageData(width, height);
    let frame = 0;
    if(!interpolated) {
        const drawFrame = () => {
            for (let i = 0; i < data[frame].pixels.length; i++) {
                imgData.data[i * 4 + 0] = data[frame].pixels[i][0];
                imgData.data[i * 4 + 1] = data[frame].pixels[i][1];
                imgData.data[i * 4 + 2] = data[frame].pixels[i][2];
                imgData.data[i * 4 + 3] = data[frame].pixels[i][3];
            }
            ctx.putImageData(imgData, 0, 0);

            newCtx.clearRect(0, 0, newCanvas.width, newCanvas.height);
            newCtx.drawImage(canvas, 0, 0);
            frame = (frame + 1) % data.length;
            setTimeout(drawFrame, 50 * data[frame].duration);
        };

        drawFrame();
    } else {
        let subFrame = 0;
        const drawInterpolatingFrame = () => {
            const nextFrame = (frame + 1) % data.length;
            const duration = data[frame].duration;
            const percentageCurrent = subFrame / duration;

            for (let i = 0; i < data[frame].pixels.length; i++) {
                imgData.data[i * 4 + 0] = (1 - percentageCurrent) * data[frame].pixels[i][0] + percentageCurrent * data[nextFrame].pixels[i][0];
                imgData.data[i * 4 + 1] = (1 - percentageCurrent) * data[frame].pixels[i][1] + percentageCurrent * data[nextFrame].pixels[i][1];
                imgData.data[i * 4 + 2] = (1 - percentageCurrent) * data[frame].pixels[i][2] + percentageCurrent * data[nextFrame].pixels[i][2];
                imgData.data[i * 4 + 3] = (1 - percentageCurrent) * data[frame].pixels[i][3] + percentageCurrent * data[nextFrame].pixels[i][3];
            }
            ctx.putImageData(imgData, 0, 0);

            newCtx.clearRect(0, 0, newCanvas.width, newCanvas.height);
            newCtx.drawImage(canvas, 0, 0);
            subFrame = subFrame + 1;

            if(subFrame === duration) {
                subFrame = 0;
                frame = nextFrame;
            }
        };

        drawInterpolatingFrame();
        setInterval(drawInterpolatingFrame, 50);
    }
    return newCanvas;
}

function annotateCuboidData(cuboid) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("cuboid-data")

    for (const face of cuboid) {
        const subWrapper = document.createElement("div");
        subWrapper.classList.add("v-center");

        const faceLabel = document.createElement("h5");
        faceLabel.innerText = face.face;

        let imageRender;
        if ("framePixels" in face.imageData) {
            imageRender = createAnimationFromRGBAData(face.imageData.framePixels, face.imageData.frameWidth, face.imageData.frameHeight, face.imageData.doInterpolate);
        } else {
            imageRender = createCanvasFromRGBAData(face.imageData.pixels, face.imageData.width, face.imageData.height);
        }
        subWrapper.append(faceLabel, imageRender);
        wrapper.appendChild(subWrapper);
    }

    return wrapper;
}