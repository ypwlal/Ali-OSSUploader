var proto = {};

proto.readCheckpoint = function () {

    if (!this.options.saveChunk) {
        return {};
    }

    var id = this.uniqueId;

    if (!id || !localStorage[id]) {
        return {}
    }

    return JSON.parse(localStorage[id]) || {};
}


proto.saveCheckpoint = function () {

    if (!this.options.saveChunk) {
        return;
    }

    var id = this.uniqueId;

    if (!id || !this.checkpoint) {
        return;
    }

    if (this.checkpoint.partSize * this.checkpoint.doneParts.length >= this.checkpoint.fileSize) {
        return;
    }

    localStorage[id] = JSON.stringify(this.checkpoint);
}

proto.clearCheckpoint = function () {

    var id = this.uniqueId;

    if (!id) {
        return;
    } else {
        localStorage.removeItem(id);
    }
}

export default proto;