// Reconstructed Laya Embind adapter. Recast/Detour algorithms remain upstream.
#include <emscripten/bind.h>
#include <Recast.h>
#include <DetourAlloc.h>
#include <DetourNavMesh.h>
#include <DetourNavMeshBuilder.h>
#include <DetourNavMeshQuery.h>
#include <DetourCrowd.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <map>
#include <memory>
#include <vector>
using namespace emscripten;
namespace laya {
template <class T> std::vector<T> read(val a) {
    return convertJSArrayToNumberVector<T>(a);
}
template <class T> val array(const T *p, int n) {
    val a = val::array();
    for (int i = 0; i < n; i++)
        a.set(i, p[i]);
    return a;
}
template <class T> val array(const std::vector<T> &p) { return val::array(p); }
float num(val o, const char *k, float d) {
    auto v = o[k];
    return v.isUndefined() ? d : v.as<float>();
}
unsigned packed(dtStatus s) {
    return (s & DT_STATUS_DETAIL_MASK) | (dtStatusSucceed(s) ? 2 : 0) | (dtStatusFailed(s) ? 1 : 0) |
           ((s & DT_IN_PROGRESS) ? 4 : 0);
}
struct TileData {
    std::vector<float> verts;
    std::vector<int> tris;
    std::vector<unsigned char> areas;
    void setTriVertex(val a) { verts = read<float>(a); }
    void setTriIndex(val a) { tris = read<int>(a); }
    void setTriFlag(val a) { areas = read<unsigned char>(a); }
    void destroy() {
        verts.clear();
        tris.clear();
        areas.clear();
    }
};
struct TileCache {
    std::vector<float> source, verts;
    std::vector<int> tris;
    std::vector<unsigned char> areas;
    void init(TileData *d) {
        source = verts = d->verts;
        tris = d->tris;
        areas = d->areas;
    }
    void setFlag(unsigned a) { areas.assign(tris.size() / 3, a); }
    int getTriIndexCount() const { return tris.size(); }
    int getTriVertexCount() const { return verts.size(); }
    val getVerts() { return val(typed_memory_view(verts.size(), verts.data())); }
    val getTris() { return val(typed_memory_view(tris.size(), tris.data())); }
    void transfromData(val matrix) {
        auto m = read<float>(matrix);
        if (m.size() != 16)
            return;
        verts.resize(source.size());
        for (unsigned i = 0; i < source.size(); i += 3) {
            float x = source[i], y = source[i + 1], z = source[i + 2];
            verts[i] = x * m[0] + y * m[4] + z * m[8] + m[12];
            verts[i + 1] = x * m[1] + y * m[5] + z * m[9] + m[13];
            verts[i + 2] = x * m[2] + y * m[6] + z * m[10] + m[14];
        }
    }
    void destroy() {
        source.clear();
        verts.clear();
        tris.clear();
        areas.clear();
    }
};
struct Link {
    std::vector<float> ends;
    float radius;
    unsigned char dir, area;
};
struct Links {
    std::map<unsigned, Link> data;
    void addOffMeshConnection(unsigned id, val start, val end, float radius, int dir, unsigned area) {
        auto v = read<float>(start), w = read<float>(end);
        v.insert(v.end(), w.begin(), w.end());
        data[id] = {v, radius, (unsigned char)dir, (unsigned char)area};
    }
    void deleteOffMeshConnection(unsigned id) { data.erase(id); }
};
struct Volume {
    std::vector<float> verts;
    float min, max;
    unsigned char area;
};
struct Volumes {
    bool is3D = true;
    std::map<unsigned, Volume> data;
    void setIs3D(bool v) { is3D = v; }
    void addCovexVoume(unsigned id, val verts, float min, float max, unsigned area) {
        data[id] = {read<float>(verts), min, max, (unsigned char)area};
    }
    void deleteCovexVoume(unsigned id) { data.erase(id); }
};
struct RefPoint {
    unsigned polyRef = 0;
    std::array<float, 3> data = {};
};
struct Mesh {
    dtNavMesh *p = dtAllocNavMesh();
    ~Mesh() { dtFreeNavMesh(p); }
    bool init(val min, val max, float cs, int tileSize) {
        auto a = read<float>(min), b = read<float>(max);
        int w = 0, h = 0;
        rcCalcGridSize(a.data(), b.data(), cs, &w, &h);
        unsigned count = ((w + tileSize - 1) / tileSize) * ((h + tileSize - 1) / tileSize);
        unsigned bits = 0;
        while ((1u << bits) < count && bits < 14)
            bits++;
        dtNavMeshParams c = {};
        rcVcopy(c.orig, a.data());
        c.tileWidth = c.tileHeight = cs * tileSize;
        c.maxTiles = 1 << bits;
        c.maxPolys = 1 << (22 - bits);
        return dtStatusSucceed(p->init(&c));
    }
    int getMaxTiles() { return p->getMaxTiles(); }
    dtMeshTile *getTile(int i) {
        return const_cast<dtMeshTile *>(static_cast<const dtNavMesh *>(p)->getTile(i));
    }
    dtTileRef getTileRefAt(int x, int y, int layer) { return p->getTileRefAt(x, y, layer); }
    unsigned getPolyFlags(dtPolyRef r) {
        unsigned short f = 0;
        p->getPolyFlags(r, &f);
        return f;
    }
    unsigned getPolyArea(dtPolyRef r) {
        unsigned char a = 0;
        p->getPolyArea(r, &a);
        return a;
    }
    unsigned removeTile(int x, int y) {
        return packed(p->removeTile(p->getTileRefAt(x, y, 0), nullptr, nullptr));
    }
    unsigned getOffMeshConnectionPolyEndPoints(dtPolyRef a, dtPolyRef b, val start, val end) {
        float s[3] = {}, e[3] = {};
        auto status = p->getOffMeshConnectionPolyEndPoints(a, b, s, e);
        for (int i = 0; i < 3; i++) {
            start.set(i, s[i]);
            end.set(i, e[i]);
        }
        return packed(status);
    }
    bool addTile(val settings, val tile, val pointers, Links *links, Volumes *volumes) {
        std::vector<float> verts;
        std::vector<int> tris;
        std::vector<unsigned char> areas;
        auto ptrs = read<uintptr_t>(pointers);
        for (auto ptr : ptrs) {
            auto c = reinterpret_cast<TileCache *>(ptr);
            int base = verts.size() / 3;
            verts.insert(verts.end(), c->verts.begin(), c->verts.end());
            for (auto i : c->tris)
                tris.push_back(i + base);
            areas.insert(areas.end(), c->areas.begin(), c->areas.end());
        }
        if (verts.empty() || areas.size() != tris.size() / 3)
            return false;
        rcContext ctx;
        rcConfig cfg = {};
        cfg.cs = num(settings, "cellSize", .2);
        cfg.ch = num(settings, "cellHeight", .3);
        cfg.tileSize = num(settings, "tileSize", 32);
        cfg.walkableSlopeAngle = num(settings, "agentMaxSlope", 45);
        float height = num(tile, "agentHeight", 1.8), radius = num(tile, "agentRadius", .2),
              climb = num(tile, "agentMaxClimb", .3);
        cfg.walkableHeight = std::max(1, (int)ceilf(height / cfg.ch));
        cfg.walkableRadius = (int)ceilf(radius / cfg.cs);
        cfg.walkableClimb = (int)ceilf(climb / cfg.ch);
        cfg.borderSize = cfg.walkableRadius + 3;
        cfg.width = cfg.height = cfg.tileSize + cfg.borderSize * 2;
        cfg.maxEdgeLen = (int)num(tile, "maxEdgeLen", 12);
        cfg.maxSimplificationError = num(tile, "maxSimplificationError", .9);
        cfg.maxVertsPerPoly = 6;
        cfg.minRegionArea = 64;
        cfg.mergeRegionArea = 400;
        cfg.detailSampleDist = cfg.cs * 6;
        cfg.detailSampleMaxError = cfg.ch;
        auto bmin = read<float>(tile["bmin"]), bmax = read<float>(tile["bmax"]);
        rcVcopy(cfg.bmin, bmin.data());
        rcVcopy(cfg.bmax, bmax.data());
        for (int axis : {0, 2}) {
            cfg.bmin[axis] -= cfg.borderSize * cfg.cs;
            cfg.bmax[axis] += cfg.borderSize * cfg.cs;
        }
        // Laya's legacy geometry can have either winding. Normalize upward faces,
        // leaving the slope calculation and rejection to upstream Recast.
        for (unsigned i = 0; i < tris.size(); i += 3) {
            auto a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
            float ny = (verts[b + 2] - verts[a + 2]) * (verts[c] - verts[a]) -
                       (verts[b] - verts[a]) * (verts[c + 2] - verts[a + 2]);
            if (ny < 0)
                std::swap(tris[i + 1], tris[i + 2]);
        }
        rcClearUnwalkableTriangles(&ctx, cfg.walkableSlopeAngle, verts.data(), verts.size() / 3, tris.data(),
                                   tris.size() / 3, areas.data());
        auto hf = std::unique_ptr<rcHeightfield, decltype(&rcFreeHeightField)>(rcAllocHeightfield(),
                                                                               rcFreeHeightField);
        if (!hf || !rcCreateHeightfield(&ctx, *hf, cfg.width, cfg.height, cfg.bmin, cfg.bmax, cfg.cs, cfg.ch))
            return false;
        if (!rcRasterizeTriangles(&ctx, verts.data(), verts.size() / 3, tris.data(), areas.data(),
                                  areas.size(), *hf, cfg.walkableClimb))
            return false;
        rcFilterLowHangingWalkableObstacles(&ctx, cfg.walkableClimb, *hf);
        rcFilterLedgeSpans(&ctx, cfg.walkableHeight, cfg.walkableClimb, *hf);
        rcFilterWalkableLowHeightSpans(&ctx, cfg.walkableHeight, *hf);
        auto chf = std::unique_ptr<rcCompactHeightfield, decltype(&rcFreeCompactHeightfield)>(
            rcAllocCompactHeightfield(), rcFreeCompactHeightfield);
        if (!chf || !rcBuildCompactHeightfield(&ctx, cfg.walkableHeight, cfg.walkableClimb, *hf, *chf))
            return false;
        hf.reset();
        if (!rcErodeWalkableArea(&ctx, cfg.walkableRadius, *chf))
            return false;
        for (auto &pair : volumes->data) {
            auto &v = pair.second;
            if (!volumes->is3D) {
                rcMarkConvexPolyArea(&ctx, v.verts.data(), v.verts.size() / 3, v.min, v.max, v.area, *chf);
                continue;
            }
            // 3D volumes use Laya's 22-float packet: world AABB + inverse box matrix.
            // It is not a list of convex polygon vertices (the 2D representation).
            if (v.verts.size() != 22)
                continue;
            auto &box = v.verts;
            const float *m = box.data() + 6;
            for (int z = 0; z < chf->height; ++z)
                for (int x = 0; x < chf->width; ++x) {
                    float wx = chf->bmin[0] + (x + .5f) * chf->cs;
                    float wz = chf->bmin[2] + (z + .5f) * chf->cs;
                    if (wx < box[0] || wx > box[3] || wz < box[2] || wz > box[5])
                        continue;
                    auto &cell = chf->cells[x + z * chf->width];
                    for (unsigned i = cell.index; i < cell.index + cell.count; ++i) {
                        if (chf->areas[i] == RC_NULL_AREA)
                            continue;
                        float wy = chf->bmin[1] + chf->spans[i].y * chf->ch;
                        float lx = wx * m[0] + wy * m[4] + wz * m[8] + m[12];
                        float ly = wx * m[1] + wy * m[5] + wz * m[9] + m[13];
                        float lz = wx * m[2] + wy * m[6] + wz * m[10] + m[14];
                        if (fabsf(lx) <= 1 && fabsf(ly) <= 1 && fabsf(lz) <= 1)
                            chf->areas[i] = v.area;
                    }
                }
        }
        int partition = num(tile, "partitionType", 0);
        bool ok = false;
        if (partition == 0)
            ok = rcBuildDistanceField(&ctx, *chf) &&
                 rcBuildRegions(&ctx, *chf, cfg.borderSize, cfg.minRegionArea, cfg.mergeRegionArea);
        else if (partition == 1)
            ok = rcBuildRegionsMonotone(&ctx, *chf, cfg.borderSize, cfg.minRegionArea, cfg.mergeRegionArea);
        else
            ok = rcBuildLayerRegions(&ctx, *chf, cfg.borderSize, cfg.minRegionArea);
        if (!ok)
            return false;
        auto contours =
            std::unique_ptr<rcContourSet, decltype(&rcFreeContourSet)>(rcAllocContourSet(), rcFreeContourSet);
        if (!contours || !rcBuildContours(&ctx, *chf, cfg.maxSimplificationError, cfg.maxEdgeLen, *contours))
            return false;
        auto poly = std::unique_ptr<rcPolyMesh, decltype(&rcFreePolyMesh)>(rcAllocPolyMesh(), rcFreePolyMesh);
        if (!poly || !rcBuildPolyMesh(&ctx, *contours, cfg.maxVertsPerPoly, *poly) || !poly->npolys)
            return false;
        auto detail = std::unique_ptr<rcPolyMeshDetail, decltype(&rcFreePolyMeshDetail)>(
            rcAllocPolyMeshDetail(), rcFreePolyMeshDetail);
        if (!detail || !rcBuildPolyMeshDetail(&ctx, *poly, *chf, cfg.detailSampleDist,
                                              cfg.detailSampleMaxError, *detail))
            return false;
        for (int i = 0; i < poly->npolys; i++)
            poly->flags[i] = poly->areas[i] ? 1u << (poly->areas[i] - 1) : 0;
        std::vector<float> ends, rads;
        std::vector<unsigned char> dirs, linkAreas;
        std::vector<unsigned short> flags;
        std::vector<unsigned> ids;
        for (auto &pair : links->data) {
            auto &l = pair.second;
            ends.insert(ends.end(), l.ends.begin(), l.ends.end());
            rads.push_back(l.radius);
            dirs.push_back(l.dir ? DT_OFFMESH_CON_BIDIR : 0);
            linkAreas.push_back(l.area);
            flags.push_back(l.area ? 1u << (l.area - 1) : 0);
            ids.push_back(pair.first);
        }
        dtNavMeshCreateParams params = {};
        params.verts = poly->verts;
        params.vertCount = poly->nverts;
        params.polys = poly->polys;
        params.polyAreas = poly->areas;
        params.polyFlags = poly->flags;
        params.polyCount = poly->npolys;
        params.nvp = poly->nvp;
        params.detailMeshes = detail->meshes;
        params.detailVerts = detail->verts;
        params.detailVertsCount = detail->nverts;
        params.detailTris = detail->tris;
        params.detailTriCount = detail->ntris;
        params.offMeshConVerts = ends.data();
        params.offMeshConRad = rads.data();
        params.offMeshConDir = dirs.data();
        params.offMeshConAreas = linkAreas.data();
        params.offMeshConFlags = flags.data();
        params.offMeshConUserID = ids.data();
        params.offMeshConCount = ids.size();
        params.walkableHeight = height;
        params.walkableRadius = radius;
        params.walkableClimb = climb;
        params.tileX = num(tile, "tx", 0);
        params.tileY = num(tile, "ty", 0);
        params.tileLayer = 0;
        rcVcopy(params.bmin, poly->bmin);
        rcVcopy(params.bmax, poly->bmax);
        params.cs = cfg.cs;
        params.ch = cfg.ch;
        params.buildBvTree = true;
        unsigned char *data = nullptr;
        int size = 0;
        if (!dtCreateNavMeshData(&params, &data, &size))
            return false;
        auto ref = p->getTileRefAt(params.tileX, params.tileY, 0);
        if (ref)
            p->removeTile(ref, nullptr, nullptr);
        auto status = p->addTile(data, size, DT_TILE_FREE_DATA, 0, nullptr);
        if (dtStatusFailed(status)) {
            dtFree(data);
            return false;
        }
        return true;
    }
};
struct Query {
    std::vector<dtPolyRef> visited;
    dtNavMeshQuery *p = dtAllocNavMeshQuery();
    Mesh *mesh = nullptr;
    ~Query() { dtFreeNavMeshQuery(p); }
    unsigned init(Mesh *m, int nodes) {
        mesh = m;
        return packed(p->init(m->p, nodes));
    }
    val findNearestPoly(val pos, val ext, dtQueryFilter *f) {
        auto v = read<float>(pos), e = read<float>(ext);
        dtPolyRef r = 0;
        float out[3] = {};
        p->findNearestPoly(v.data(), e.data(), f, &r, out);
        val result = val::object();
        result.set("polyRef", r);
        result.set("data", array(out, 3));
        return result;
    }
    val closestPointOnPoly(dtPolyRef ref, val pos) {
        auto v = read<float>(pos);
        float out[3] = {};
        p->closestPointOnPoly(ref, v.data(), out, nullptr);
        return array(out, 3);
    }
    val closestPointOnPolyByRefPointData(val ref) {
        return closestPointOnPoly(ref["polyRef"].as<dtPolyRef>(), ref["data"]);
    }
    val findPath(val start, val end, dtQueryFilter *f, int max) {
        auto a = read<float>(start["data"]), b = read<float>(end["data"]);
        std::vector<dtPolyRef> polys(max);
        int n = 0;
        auto s = p->findPath(start["polyRef"].as<dtPolyRef>(), end["polyRef"].as<dtPolyRef>(), a.data(),
                             b.data(), f, polys.data(), &n, max);
        polys.resize(n);
        val out = val::object();
        out.set("Status", packed(s));
        out.set("polys", array(polys));
        return out;
    }
    val getPolyHeight(dtPolyRef ref, val pos) {
        auto v = read<float>(pos);
        float h = 0;
        auto s = p->getPolyHeight(ref, v.data(), &h);
        val out = val::object();
        out.set("height", h);
        out.set("Status", packed(s));
        return out;
    }
    val findStraightPath(val start, val end, val path, int size, int max) {
        auto a = read<float>(start), b = read<float>(end);
        auto refs = read<dtPolyRef>(path);
        std::vector<float> points(max * 3);
        std::vector<unsigned char> flags(max);
        std::vector<dtPolyRef> polys(max);
        int count = 0;
        p->findStraightPath(a.data(), b.data(), refs.data(), std::min(size, (int)refs.size()), points.data(),
                            flags.data(), polys.data(), &count, max);
        val out = val::object();
        out.set("nsteerPath", count);
        out.set("steerPath", array(points));
        out.set("steerPathFlags", array(flags));
        out.set("steerPathPolys", array(polys));
        return out;
    }
    val moveAlongSurface(dtPolyRef ref, val start, val end, dtQueryFilter *f, int max) {
        auto a = read<float>(start), b = read<float>(end);
        float pos[3] = {};
        visited.resize(max);
        int count = 0;
        auto s = p->moveAlongSurface(ref, a.data(), b.data(), f, pos, visited.data(), &count, max);
        visited.resize(count);
        val out = val::object();
        out.set("resultPos", array(pos, 3));
        out.set("visited", val(typed_memory_view(count, visited.data())));
        out.set("status", packed(s));
        return out;
    }
    val findDistanceToWall(val start, dtQueryFilter *f, float radius) {
        auto a = read<float>(start["data"]);
        float dist = 0, pos[3] = {}, normal[3] = {};
        auto s =
            p->findDistanceToWall(start["polyRef"].as<dtPolyRef>(), a.data(), radius, f, &dist, pos, normal);
        val out = val::object();
        out.set("dist", dist);
        out.set("pos", array(pos, 3));
        out.set("normal", array(normal, 3));
        out.set("Status", packed(s));
        return out;
    }
    static float random() { return static_cast<float>(rand()) / static_cast<float>(RAND_MAX); }
    unsigned findRandomPoint(dtQueryFilter *f, RefPoint output) {
        return packed(p->findRandomPoint(f, random, &output.polyRef, output.data.data()));
    }
    unsigned findRandomPointAroundCircle(val start, float radius, dtQueryFilter *f, RefPoint output) {
        auto a = read<float>(start["data"]);
        return packed(p->findRandomPointAroundCircle(start["polyRef"].as<dtPolyRef>(), a.data(), radius, f,
                                                     random, &output.polyRef, output.data.data()));
    }
};
struct Crowd {
    dtCrowd *p = dtAllocCrowd();
    std::vector<float> output;
    ~Crowd() { dtFreeCrowd(p); }
    bool init(int count, float radius, Mesh *mesh) {
        output.assign(count * 6, 0);
        bool ok = p->init(count, radius, mesh->p);
        if (ok) {
            dtObstacleAvoidanceParams a = *p->getObstacleAvoidanceParams(0);
            a.velBias = .5;
            for (int i = 0; i < 4; i++) {
                a.adaptiveDivs = i < 2 ? 5 : 7;
                a.adaptiveRings = i == 3 ? 3 : 2;
                a.adaptiveDepth = i < 2 ? i + 1 : 3;
                p->setObstacleAvoidanceParams(i, &a);
            }
        }
        return ok;
    }
    int addAgent(val pos, dtCrowdAgentParams *params) {
        auto a = read<float>(pos);
        return p->addAgent(a.data(), params);
    }
    void removeAgent(int i) { p->removeAgent(i); }
    dtCrowdAgent *getAgent(int i) { return p->getEditableAgent(i); }
    int getAgentCount() { return p->getAgentCount(); }
    bool requestMoveTarget(int i, val ref) {
        auto a = read<float>(ref["data"]);
        return p->requestMoveTarget(i, ref["polyRef"].as<dtPolyRef>(), a.data());
    }
    bool requestMoveVelocity(int i, val pos) {
        auto a = read<float>(pos);
        return p->requestMoveVelocity(i, a.data());
    }
    dtQueryFilter *getFilter(int i) { return p->getEditableFilter(i); }
    void update(float dt) { p->update(dt, nullptr); }
    val updateData(float dt) {
        update(dt);
        for (int i = 0; i < getAgentCount(); i++) {
            auto a = p->getAgent(i);
            if (a->active) {
                for (int j = 0; j < 3; j++) {
                    output[i * 6 + j] = a->npos[j];
                    output[i * 6 + j + 3] = a->dvel[j];
                }
            }
        }
        return val(typed_memory_view(output.size(), output.data()));
    }
};
val mergeCorridorStartMoved(val path, int max, val visited) {
    auto p = read<dtPolyRef>(path), v = read<dtPolyRef>(visited);
    int fp = -1, fv = -1;
    for (int i = (int)p.size() - 1; i >= 0 && fp < 0; i--)
        for (int j = (int)v.size() - 1; j >= 0; j--)
            if (p[i] == v[j]) {
                fp = i;
                fv = j;
                break;
            }
    if (fp < 0)
        return path;
    std::vector<dtPolyRef> out;
    for (int j = v.size() - 1; j >= fv; j--)
        out.push_back(v[j]);
    for (unsigned i = fp + 1; i < p.size() && (int)out.size() < max; i++)
        out.push_back(p[i]);
    return array(out);
}
val fixupShortcuts(val path, Query *q) {
    auto refs = read<dtPolyRef>(path);
    if (refs.size() < 3)
        return path;
    const dtMeshTile *tile;
    const dtPoly *poly;
    if (dtStatusFailed(q->mesh->p->getTileAndPolyByRef(refs[0], &tile, &poly)))
        return path;
    std::vector<dtPolyRef> neighbours;
    for (unsigned i = poly->firstLink; i != DT_NULL_LINK; i = tile->links[i].next)
        neighbours.push_back(tile->links[i].ref);
    int cut = 0;
    for (int i = std::min((int)refs.size(), 6) - 1; i >= 2 && !cut; i--)
        if (std::find(neighbours.begin(), neighbours.end(), refs[i]) != neighbours.end())
            cut = i;
    if (cut) {
        refs.erase(refs.begin() + 1, refs.begin() + cut);
    }
    return array(refs);
}
} // namespace laya

EMSCRIPTEN_BINDINGS(laya_recast) {
    using namespace laya;
    value_array<std::array<float, 3>>("Float3")
        .element(emscripten::index<0>())
        .element(emscripten::index<1>())
        .element(emscripten::index<2>());
    value_object<RefPoint>("dtRefPointData")
        .field("polyRef", &RefPoint::polyRef)
        .field("data", &RefPoint::data);
    class_<laya::Links>("dtOffMeshConnection")
        .constructor<>()
        .function("addOffMeshConnection", &laya::Links::addOffMeshConnection, allow_raw_pointers())
        .function("deleteOffMeshConnection", &laya::Links::deleteOffMeshConnection, allow_raw_pointers());
    class_<laya::Volumes>("dtConvexVolume")
        .constructor<>()
        .function("setIs3D", &laya::Volumes::setIs3D, allow_raw_pointers())
        .function("addCovexVoume", &laya::Volumes::addCovexVoume, allow_raw_pointers())
        .function("deleteCovexVoume", &laya::Volumes::deleteCovexVoume, allow_raw_pointers());
    class_<laya::TileData>("dtNavTileData")
        .constructor<>()
        .function("setTriVertex", &laya::TileData::setTriVertex, allow_raw_pointers())
        .function("setTriIndex", &laya::TileData::setTriIndex, allow_raw_pointers())
        .function("setTriFlag", &laya::TileData::setTriFlag, allow_raw_pointers())
        .function("destroy", &laya::TileData::destroy, allow_raw_pointers());
    class_<laya::TileCache>("dtNavTileCache")
        .constructor<>()
        .function("init", &laya::TileCache::init, allow_raw_pointers())
        .function("setFlag", &laya::TileCache::setFlag, allow_raw_pointers())
        .function("getTriIndexCount", &laya::TileCache::getTriIndexCount, allow_raw_pointers())
        .function("getTriVertexCount", &laya::TileCache::getTriVertexCount, allow_raw_pointers())
        .function("getVerts", &laya::TileCache::getVerts, allow_raw_pointers())
        .function("getTris", &laya::TileCache::getTris, allow_raw_pointers())
        .function("transfromData", &laya::TileCache::transfromData, allow_raw_pointers())
        .function("destroy", &laya::TileCache::destroy, allow_raw_pointers());
    class_<dtMeshHeader>("dtMeshHeader")
        .constructor<>()
        .property("magic", &dtMeshHeader::magic)
        .property("x", &dtMeshHeader::x)
        .property("y", &dtMeshHeader::y)
        .property("layer", &dtMeshHeader::layer)
        .property("userId", &dtMeshHeader::userId)
        .property("polyCount", &dtMeshHeader::polyCount)
        .property("vertCount", &dtMeshHeader::vertCount)
        .property("maxLinkCount", &dtMeshHeader::maxLinkCount)
        .property("detailMeshCount", &dtMeshHeader::detailMeshCount)
        .property("detailVertCount", &dtMeshHeader::detailVertCount)
        .property("detailTriCount", &dtMeshHeader::detailTriCount)
        .property("walkableHeight", &dtMeshHeader::walkableHeight)
        .property("walkableRadius", &dtMeshHeader::walkableRadius)
        .property("walkableClimb", &dtMeshHeader::walkableClimb)
        .function("boundMax",
                  optional_override([](dtMeshHeader &o) { return val(typed_memory_view(3, o.bmax)); }),
                  allow_raw_pointers())
        .function("boundMin",
                  optional_override([](dtMeshHeader &o) { return val(typed_memory_view(3, o.bmin)); }),
                  allow_raw_pointers());
    class_<dtPoly>("dtPoly")
        .property("firstLink", &dtPoly::firstLink)
        .property("flags", &dtPoly::flags)
        .property("vertCount", &dtPoly::vertCount)
        .property("areaAndtype", &dtPoly::areaAndtype)
        .function("getVerts", optional_override([](dtPoly &o) {
                      return val(typed_memory_view(DT_VERTS_PER_POLYGON, o.verts));
                  }),
                  allow_raw_pointers())
        .function("getType", &dtPoly::getType, allow_raw_pointers())
        .function("getArea", &dtPoly::getArea, allow_raw_pointers())
        .function("getNeis", optional_override([](dtPoly &o, int i) { return o.neis[i]; }),
                  allow_raw_pointers());
    class_<dtPolyDetail>("dtPolyDetail")
        .property("vertBase", &dtPolyDetail::vertBase)
        .property("triBase", &dtPolyDetail::triBase)
        .property("vertCount", &dtPolyDetail::vertCount)
        .property("triCount", &dtPolyDetail::triCount);
    class_<dtMeshTile>("dtMeshTile")
        .function("getheader", optional_override([](dtMeshTile &o) { return o.header; }),
                  allow_raw_pointers())
        .function("getVerts", optional_override([](dtMeshTile &o) {
                      return val(typed_memory_view(o.header ? o.header->vertCount * 3 : 0, o.verts));
                  }),
                  allow_raw_pointers())
        .function("getPolys", optional_override([](dtMeshTile &o, int i) { return &o.polys[i]; }),
                  allow_raw_pointers())
        .function("getPolyDetail", optional_override([](dtMeshTile &o, int i) { return &o.detailMeshes[i]; }),
                  allow_raw_pointers())
        .function("getdetailTris", optional_override([](dtMeshTile &o) {
                      return val(
                          typed_memory_view(o.header ? o.header->detailTriCount * 4 : 0, o.detailTris));
                  }),
                  allow_raw_pointers())
        .function("getdetailVerts", optional_override([](dtMeshTile &o) {
                      return val(
                          typed_memory_view(o.header ? o.header->detailVertCount * 3 : 0, o.detailVerts));
                  }),
                  allow_raw_pointers());
    class_<dtCrowdAgentParams>("dtCrowdAgentParams")
        .constructor<>()
        .property("radius", &dtCrowdAgentParams::radius)
        .property("height", &dtCrowdAgentParams::height)
        .property("maxAcceleration", &dtCrowdAgentParams::maxAcceleration)
        .property("maxSpeed", &dtCrowdAgentParams::maxSpeed)
        .property("collisionQueryRange", &dtCrowdAgentParams::collisionQueryRange)
        .property("pathOptimizationRange", &dtCrowdAgentParams::pathOptimizationRange)
        .property("separationWeight", &dtCrowdAgentParams::separationWeight)
        .property("updateFlags", &dtCrowdAgentParams::updateFlags)
        .property("obstacleAvoidanceType", &dtCrowdAgentParams::obstacleAvoidanceType)
        .property("queryFilterType", &dtCrowdAgentParams::queryFilterType);
    class_<dtCrowdAgent>("dtCrowdAgent")
        .property("active", &dtCrowdAgent::active)
        .property("state", &dtCrowdAgent::state)
        .function("getparams", optional_override([](dtCrowdAgent &o) { return &o.params; }),
                  allow_raw_pointers())
        .property("targetState", &dtCrowdAgent::targetState)
        .property("targetRef", &dtCrowdAgent::targetRef)
        .function("getCurPos", optional_override([](dtCrowdAgent &o, val a) {
                      for (int i = 0; i < 3; i++)
                          a.set(i, o.npos[i]);
                  }),
                  allow_raw_pointers())
        .function("getCurDir", optional_override([](dtCrowdAgent &o, val a) {
                      for (int i = 0; i < 3; i++)
                          a.set(i, o.dvel[i]);
                  }),
                  allow_raw_pointers());
    class_<laya::Crowd>("dtCrowd")
        .constructor<>()
        .function("init", &laya::Crowd::init, allow_raw_pointers())
        .function("addAgent", &laya::Crowd::addAgent, allow_raw_pointers())
        .function("removeAgent", &laya::Crowd::removeAgent, allow_raw_pointers())
        .function("getAgent", &laya::Crowd::getAgent, allow_raw_pointers())
        .function("getAgentCount", &laya::Crowd::getAgentCount, allow_raw_pointers())
        .function("requestMoveTarget", &laya::Crowd::requestMoveTarget, allow_raw_pointers())
        .function("requestMoveVelocity", &laya::Crowd::requestMoveVelocity, allow_raw_pointers())
        .function("getFilter", &laya::Crowd::getFilter, allow_raw_pointers())
        .function("update", &laya::Crowd::update, allow_raw_pointers());
    class_<laya::Mesh>("dtNavMesh")
        .constructor<>()
        .function("init", optional_override([](Mesh &o, val a, val b, float cs, int size) {
                      o.init(a, b, cs, size);
                  }),
                  allow_raw_pointers())
        .function("getMaxTiles", &laya::Mesh::getMaxTiles, allow_raw_pointers())
        .function("addTile", optional_override([](Mesh &o, val a, val b, val c, Links *l, Volumes *v) {
                      o.addTile(a, b, c, l, v);
                  }),
                  allow_raw_pointers())
        .function("getTile", &laya::Mesh::getTile, allow_raw_pointers())
        .function("getTileRefAt", &laya::Mesh::getTileRefAt, allow_raw_pointers())
        .function("getPolyFlags", &laya::Mesh::getPolyFlags, allow_raw_pointers())
        .function("getPolyArea", &laya::Mesh::getPolyArea, allow_raw_pointers())
        .function("removeTile", optional_override([](Mesh &o, int x, int y) { o.removeTile(x, y); }),
                  allow_raw_pointers())
        .function("getOffMeshConnectionPolyEndPoints", &laya::Mesh::getOffMeshConnectionPolyEndPoints,
                  allow_raw_pointers());
    class_<dtQueryFilter>("dtQueryFilter")
        .constructor<>()
        .function("getAreaCost", &dtQueryFilter::getAreaCost, allow_raw_pointers())
        .function("setAreaCost", &dtQueryFilter::setAreaCost, allow_raw_pointers())
        .function("getIncludeFlags", &dtQueryFilter::getIncludeFlags, allow_raw_pointers())
        .function("setIncludeFlags", &dtQueryFilter::setIncludeFlags, allow_raw_pointers())
        .function("getExcludeFlags", &dtQueryFilter::getExcludeFlags, allow_raw_pointers())
        .function("setExcludeFlags", &dtQueryFilter::setExcludeFlags, allow_raw_pointers());
    class_<laya::Query>("dtNavMeshQuery")
        .constructor<>()
        .function("init", &laya::Query::init, allow_raw_pointers())
        .function("getPolyHeight", &laya::Query::getPolyHeight, allow_raw_pointers())
        .function("findDistanceToWall", &laya::Query::findDistanceToWall, allow_raw_pointers())
        .function("findPath", &laya::Query::findPath, allow_raw_pointers())
        .function("closestPointOnPoly", &laya::Query::closestPointOnPoly, allow_raw_pointers())
        .function("closestPointOnPolyByRefPointData", &laya::Query::closestPointOnPolyByRefPointData,
                  allow_raw_pointers())
        .function("findStraightPath", &laya::Query::findStraightPath, allow_raw_pointers())
        .function("moveAlongSurface", &laya::Query::moveAlongSurface, allow_raw_pointers())
        .function("findNearestPoly", &laya::Query::findNearestPoly, allow_raw_pointers())
        .function("findRandomPoint", &laya::Query::findRandomPoint, allow_raw_pointers())
        .function("findRandomPointAroundCircle", &laya::Query::findRandomPointAroundCircle,
                  allow_raw_pointers());
    register_vector<float>("dtFloatVector");
    register_vector<dtPolyRef>("dtPolyRefVector");
    enum_<dtStraightPathFlags>("dtStraightPathFlags")
        .value("DT_STRAIGHTPATH_START", DT_STRAIGHTPATH_START)
        .value("DT_STRAIGHTPATH_END", DT_STRAIGHTPATH_END)
        .value("DT_STRAIGHTPATH_OFFMESH_CONNECTION", DT_STRAIGHTPATH_OFFMESH_CONNECTION);
    function("dtStatusSucceed", optional_override([](unsigned s) { return (s & 2) != 0; }));
    function("dtStatusFailed", optional_override([](unsigned s) { return (s & 1) != 0; }));
    function("updateCrowd", optional_override([](Crowd *c, float dt) { return c->updateData(dt); }),
             allow_raw_pointers());
    function("dtFreeNavMesh", optional_override([](Mesh *p) { delete p; }), allow_raw_pointers());
    function("dtFreeNavMeshQuery", optional_override([](Query *p) { delete p; }), allow_raw_pointers());
    function("dtFreeCrowd", optional_override([](Crowd *p) { delete p; }), allow_raw_pointers());
    function("dtFree", optional_override([](uintptr_t p) { dtFree(reinterpret_cast<void *>(p)); }));
    function("mergeCorridorStartMoved", &mergeCorridorStartMoved);
    function("fixupShortcuts", &fixupShortcuts, allow_raw_pointers());
}
