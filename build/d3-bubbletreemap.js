(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('planck-js')) :
    typeof define === 'function' && define.amd ? define(['exports', 'planck-js'], factory) :
    (factory((global.d3 = global.d3 || {}),global.planck));
}(this, function (exports,planck) { 'use strict';

    function getLayerClusters(hierarchyRoot, layerDepth, padding) {
        var clusters = [];

        let layerNodes = hierarchyRoot.descendants().filter(function(candidate) {
            return candidate.depth === layerDepth;
        });

        layerNodes.forEach(function(node) {
            // get all the leave nodes that actually form this cluster
            // the data of these leave nodes + padding will be used to do the simulation
            let clusterNodes = node.descendants().filter(function(candidate){
                return !candidate.children;
            });

            let clusterParent = node.ancestors().filter(function(ancestor) {
                return ancestor.depth === layerDepth;
            })[0];

            clusterNodes.forEach(function(node) {
                let path = node.path(clusterParent).slice(1,-1);

                let uncertaintySum = path.reduce(function(acc, pathnode){
                    return acc + pathnode.uncertainty;
                }, 0);

                let contourClusterParentUncertainty = clusterParent.uncertainty/2;                                // Padding for contour (contour lies 50% outside of parent node).
                let planckClusterParentUncertainty = node !== clusterParent ? clusterParent.uncertainty : 2;      // Padding for force based layout (contours should not cut each other, i.e. full parent contour should be taken into account).

                let interClusterSpacing = clusterNodes.length === 1 ? 0 : padding / 2.0; // For single circle: No padding, since it has no contour.
                //let interClusterSpacing = clusterNodes.length === 1 ? 2 : padding / 2.0; // For single circle: Smallest padding to ensure all contours are visible

                node.contourPadding = (node.depth - clusterParent.depth) * padding + uncertaintySum + contourClusterParentUncertainty;
                node.planckPadding = (node.depth - clusterParent.depth) * padding + uncertaintySum + planckClusterParentUncertainty + interClusterSpacing;
            });

            clusters.push({
                nodes: clusterNodes,
                parent: clusterParent
            });
        });

        return clusters;
    };

    // Extend array prototype by unique function.
    Array.prototype.contains = function(v) {
        for(var i = 0; i < this.length; i++) {
            if(this[i] === v) return true;
        }
        return false;
    };

    Array.prototype.unique = function() {
        var arr = [];
        for(var i = 0; i < this.length; i++) {
            if(!arr.contains(this[i])) {
                arr.push(this[i]);
            }
        }
        return arr;
    };


    function lp(hierarchyRoot, padding, width, height) {

        // Circle pack by d3.
        let pack = d3.pack()
            .radius(function(d) { console.log(d); return d.r; })
            .size([width, height]);

        pack(hierarchyRoot); // Use pack to arrange circles on deepest layer.

        for(let layerDepth = hierarchyRoot.height - 1; layerDepth >= hierarchyRoot.height - 4; layerDepth--) {
        //for(let layerDepth = hierarchyRoot.height - 1; layerDepth >= 0; layerDepth--) {
            // Get clusters of circles on this layer.
            let layerClusters = getLayerClusters(hierarchyRoot, layerDepth, padding);
            //if(layerDepth == 2)
            //        console.log("layer ", layerDepth, "cluster", i, ":", cluster.nodes[0].data.name);
            // Sort clusters by parents parent, to set correct center of attraction for bodies.
            let pps = [];
            layerClusters.forEach(function(cluster) {
                pps.push(cluster.parent.parent);
            });
            pps = pps.unique();

            // Do the layout.
            pps.forEach(function(pp, i) {
                
                let currentPPClusters = layerClusters.filter(function(cluster) {
                    return cluster.parent.parent === pp;
                });

                let circleList = [];
                currentPPClusters.forEach(function(cluster) {
                    circleList = circleList.concat(cluster.nodes);
                });

                let centroid = getCircleCentroid(circleList);

                if(layerDepth == 2)
                    console.log("layer ", layerDepth, "cluster", i, ":", currentPPClusters);

                layoutClusters(currentPPClusters, centroid);
            });
        }
    }

    function layoutClusters(layerClusters, centroid) {
        // Create world with zero gravity.
        let world = planck.World({
            gravity: planck.Vec2(0,0)
            //gravity: centroid
        });

        // Create bodies for groups.
        let layerClusterBodies = [];
        layerClusters.forEach(function(layerCluster, i) {
            console.log(i);
            layerClusterBodies.push(createClusterBody(layerCluster, world));
        });

        console.log(layerClusterBodies);

        // Create attractor.
        let attractorBody = world.createBody(planck.Vec2(centroid.x, centroid.y));
        //console.log(centroid);

        // Create joints between layerClusterBodies and attractor.
        /*layerClusterBodies.forEach(function(layerClusterBody) {
            let distanceJoint = planck.DistanceJoint( {
                    // Higher frequencyHz makes thread more persistent
                    frequencyHz : 0.9, // TODO: Try to avoid overlapping in large datasets!
                    dampingRatio : 0.0001 // Lower dampingRatio make it sooner for the thread gain original length after being stretched.
                },
                attractorBody,
                attractorBody.getPosition(),
                layerClusterBody,
                layerClusterBody.getPosition()
            );
            distanceJoint.m_length = 2; // Set the length to zero as it's calculated as the distance between the anchors. TODO: PR on planck-js repo to fix bug.

            world.createJoint(distanceJoint);
        });*/

        //console.log(layerClusters, layerClusterBodies);

        // Prepare for simulation. Typically we use a time step of 1/60 of a
        // second (60Hz) and 10 iterations. This provides a high quality simulation
        // in most game scenarios.
        let timestep = 1.0 / 60.0;
        let velocityIterations = 6;
        let positionIterations = 2;

        // Simulation loop.
        for (let i = 0; i < 66; ++i) {
            // Instruct the world to perform a single step of simulation.
            // It is generally best to keep the time step and iterations fixed.
            world.step(timestep, velocityIterations, positionIterations);
        }

        let svg1 = d3.select("#svgCircles1");
        // Write results back to hierarchy.
        for (let body = world.getBodyList(); body; body = body.getNext()) {
            for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
                if(fixture.getShape().getType() === planck.Circle.TYPE) {
                    let center = body.getWorldPoint(fixture.getShape().getCenter());
                    svg1.append("circle")
                    .attr("cx", center.x)
                    .attr("cy", center.y)
                    .attr("r", fixture.getShape().getRadius())
                    .style("fill-opacity", 0.7) 
                    .style("fill", "gray");
                    let rawCircle = fixture.getUserData();
                    rawCircle.x = center.x;
                    rawCircle.y = center.y;
                }
            }
            world.destroyBody(body);
        }
    }

    function createClusterBody(layerCluster, world) {
        // Get centroid of all circles.
        let bodyCentroid = getCircleCentroid(layerCluster.nodes);

        // Create body.
        let body = world.createDynamicBody(bodyCentroid);

        // Add circles as fixtures.
        let circleFD = {
            density: 1.0,
            friction: 0.00001,
            restitution: 1.0 // Restitution measures how 'bouncy' a fixture is. 
        };

        layerCluster.nodes.forEach(function(circle) {
            let centerGlobal = planck.Vec2(circle.x, circle.y);
            let centerLocal = centerGlobal.sub(bodyCentroid);
            let fixture = body.createFixture(planck.Circle(centerLocal, circle.r + circle.planckPadding), circleFD);
            fixture.setUserData(circle);
        });

        // Return completed body.
        for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
            if(fixture.getShape().getType() === planck.Circle.TYPE) {
                let center = body.getWorldPoint(fixture.getShape().getCenter());
                let rawCircle = fixture.getUserData();
                console.log(fixture.getUserData().data.name, center);
            }
        }
        return body;
    }

    function getCircleCentroid(circles) {
        // Calculate centroid of circle group.
        let circleMassSum = 0;
        let centroid = planck.Vec2.zero();

        circles.forEach(function(circle) {
            let circleMass = circle.r * circle.r * Math.PI;
            circleMassSum += circleMass;
            centroid.x += circle.x * circleMass;
            centroid.y += circle.y * circleMass;
        });

        centroid.mul(1.0/circleMassSum);

        return centroid;
    }


    function colorHierarchy(hierarchyRoot, colormap) {
        var classDict = {
            "https://cso.kmi.open.ac.uk/topics/artificial_intelligence" : 0,
            "https://cso.kmi.open.ac.uk/topics/robotics" : 1,
            "https://cso.kmi.open.ac.uk/topics/computer_vision" : 2,
            "https://cso.kmi.open.ac.uk/topics/computer_operating_systems" : 3,
            "https://cso.kmi.open.ac.uk/topics/bioinformatics" : 4,
            "https://cso.kmi.open.ac.uk/topics/software_engineering" : 5,
            "https://cso.kmi.open.ac.uk/topics/information_technology" : 6,
            "https://cso.kmi.open.ac.uk/topics/data_mining" : 7,
            "https://cso.kmi.open.ac.uk/topics/information_retrieval" : 8,
            "https://cso.kmi.open.ac.uk/topics/computer_programming" : 9, 
            "https://cso.kmi.open.ac.uk/topics/computer_security" : 10,
            "https://cso.kmi.open.ac.uk/topics/theoretical_computer_science" : 11,
            "https://cso.kmi.open.ac.uk/topics/computer_communication_networks" : 12,
            "https://cso.kmi.open.ac.uk/topics/internet" : 13,
            "https://cso.kmi.open.ac.uk/topics/formal_languages" : 14,
            "https://cso.kmi.open.ac.uk/topics/software" : 15,
            "https://cso.kmi.open.ac.uk/topics/hardware" : 16,
            "https://cso.kmi.open.ac.uk/topics/computer_hardware" : 17,
            "https://cso.kmi.open.ac.uk/topics/computer_system" : 18,
            "https://cso.kmi.open.ac.uk/topics/computer_systems" : 18,
            "https://cso.kmi.open.ac.uk/topics/computer_network" : 19,
            "https://cso.kmi.open.ac.uk/topics/computer_networks" : 19,
            "https://cso.kmi.open.ac.uk/topics/human_computer_interaction" : 20,
            "https://cso.kmi.open.ac.uk/topics/human-computer_interaction" :20,
            "https://cso.kmi.open.ac.uk/topics/computer_aided_design" : 21,
            "https://cso.kmi.open.ac.uk/topics/computer-aided_design" : 21,
            "https://cso.kmi.open.ac.uk/topics/operating_system" : 22,
            "https://cso.kmi.open.ac.uk/topics/operating_systems" : 22
        }
        let colorIndex = 0;
        hierarchyRoot.children.forEach(function(child) {
            //console.log(child.data.name, classDict[child.data.name.substring(1, child.data.name.length-1)]);
            colorIndex = classDict[child.data.name.substring(1, child.data.name.length-1)];
            child.descendants().forEach(function(desc){
                desc.color = colormap[colorIndex % colormap.length];
            });
            //colorIndex++;
        });
    }

    function Vec2(x, y) {
        this.x = x;
        this.y = y;

        this.distance = function (vec) {
            var deltaX = this.x - vec.x;
            var deltaY = this.y - vec.y;
            return Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
        };

        this.sub = function (vec) {
            return new Vec2(this.x - vec.x, this.y - vec.y);
        };

        this.add = function (vec) {
            return new Vec2(this.x + vec.x, this.y + vec.y);
        };

        this.scale = function (scale) {
            return new Vec2(this.x * scale, this.y * scale);
        };

        this.angle = function (vec) {
            var result = Math.atan2(vec.y, vec.x) - Math.atan2(this.y, this.x);
            if (result < 0)
                result += 2 * Math.PI;
            return result;
        }

        this.magnitude = function () {
            return Math.sqrt((this.x * this.x) + (this.y * this.y));
        }

        this.toUnitVector = function () {
            return this.scale(1.0/this.magnitude());
        }
    }

    function Arc(x, y, startAngle, endAngle, radius, startPoint = null, endPoint = null) {
        this.center = new Vec2(x, y);
        this.startAngle = startAngle;
        this.endAngle = endAngle;
        this.radius = radius;
        this.startPoint = startPoint;
        this.endPoint = endPoint;
    }

    function Circle(x, y, radius) {
        this.center = new Vec2(x, y);
        this.radius = radius;

        // See: http://paulbourke.net/geometry/circlesphere/
        this.intersects = function (circle) {
            var distance = this.center.distance(circle.center);

            // Circles are to far from each other.
            if (distance > this.radius + circle.radius)
                return false;
            // One circle is contained in the other.
            if (distance < Math.abs(this.radius - circle.radius))
                return false;
            // Circles intersect.
            return true;
        };

        // See: http://paulbourke.net/geometry/circlesphere/
        this.intersectionPoints = function (circle) {
            var P0 = this.center;
            var P1 = circle.center;

            var d = this.center.distance(circle.center);
            var a = (this.radius * this.radius - circle.radius * circle.radius + d * d) / (2 * d);
            var h = Math.sqrt(this.radius * this.radius - a * a);

            var P2 = P1.sub(P0).scale(a / d).add(P0);

            var x3 = P2.x + h * (P1.y - P0.y) / d;
            var y3 = P2.y - h * (P1.x - P0.x) / d;
            var x4 = P2.x - h * (P1.y - P0.y) / d;
            var y4 = P2.y + h * (P1.x - P0.x) / d;

            return [new Vec2(x3, y3), new Vec2(x4, y4)];
        };
    }

    function contour(nodes, curvature) {
        let circles = [];
        nodes.forEach(function (node) {
            // Add circles with radius increased by padding. This generates the spacing between circle and contour.
            circles.push(new Circle(node.x, node.y, node.r + node.contourPadding));
        });

        let arcs = [];
        
        if (circles.length == 1) {
        // for single circle
            let circle = circles[0];
            arcs.push(new Arc(circle.center.x, circle.center.y, 0, 2*Math.PI, circle.radius, getCord(circle.center, 0, circle.radius), getCord(circle.center, 0.001, circle.radius)));
        } else {
        // for multiple circles
            let outerCircleRing = getOuterCircleRing(circles, curvature);

            arcs = arcs.concat(generateCircleArcs(outerCircleRing));
            arcs = arcs.concat(generateTangentArcs(outerCircleRing, curvature));
        }

        return arcsToPaths(arcs);
    }

    let FLOATINGPOINT_EPSILON = 0.00001;

    // Get index and intersection point of next circle on border, in counter-clockwise direction.
    // The parameter 'direction' points into the direction, where the first intersection with current circle was found.
    function getNextClockwiseIntersection(currentCircleIndex, circleArray, direction) {
        let currentCircle = circleArray[currentCircleIndex];
        let allIntersections = [];

        for (let i = 0; i < circleArray.length; i++) {
            if (!(i === currentCircleIndex)) {
                if (circleArray[i].intersects(circleArray[currentCircleIndex])) {
                    let intersectionPoints = circleArray[i].intersectionPoints(circleArray[currentCircleIndex]);
                    // Store intersection points and index of corresponding circle
                    allIntersections.push({
                        'intersectionPoint': intersectionPoints[0],
                        'circleIndex': i
                    });
                    allIntersections.push({
                        'intersectionPoint': intersectionPoints[1],
                        'circleIndex': i
                    });
                }
            }
        }

        let smallestAngle = 7; // Init with max angle (> 2*PI).
        let intersectionWithSmallestAngle = undefined; // Init as undefined.
        allIntersections.forEach(function (intersection) {
            let angle = direction.angle(intersection.intersectionPoint.sub(currentCircle.center));

            if (angle > FLOATINGPOINT_EPSILON && angle < smallestAngle) {
                smallestAngle = angle;
                intersectionWithSmallestAngle = intersection;
            }
        });

        return intersectionWithSmallestAngle;
    }

    // Get ring of circles that defines the outer border, together with the corresponding intersection points.
    function getOuterCircleRing(circles, curvature) {
        // Create deep copy of circles, as they are modified in the next steps.
        //let circlesEnlarged = circles.map(a = > Object.assign({}, a));
        let circlesEnlarged = circles.map(function (a) {
            return Object.assign({}, a)
        });

        // Add the radius s of the tangent circles to avoid self-intersections.
        circlesEnlarged.forEach(function (circle) {
            circle.radius += curvature;
        });

        // Find index of the leftmost circle.
        let leftmostCircleIndex = 0;
        for (let i = 1; i < circlesEnlarged.length; i++) {
            if (circlesEnlarged[i].center.x - circlesEnlarged[i].radius < circlesEnlarged[leftmostCircleIndex].center.x - circlesEnlarged[leftmostCircleIndex].radius) {
                leftmostCircleIndex = i;
            }
        }

        // Get the outer ring of circles.
        let outerCircleRing = [];
        let index = leftmostCircleIndex;
        let referenceDirection = new Vec2(-1, 0);
        while (true) {
            let intersection = getNextClockwiseIntersection(index, circlesEnlarged, referenceDirection);
            if (intersection === undefined)
                break;

            index = intersection.circleIndex;
            let circle = circles[index];
            referenceDirection = intersection.intersectionPoint.sub(circle.center);

            if (outerCircleRing[0] && index === outerCircleRing[0].circleIndex && intersection.intersectionPoint.distance(outerCircleRing[0].intersectionPoint) < FLOATINGPOINT_EPSILON) {
                break;
            }

            outerCircleRing.push({
                'circle': circle,
                'intersectionPoint': intersection.intersectionPoint,
                'circleIndex': index
            });
        }

        return outerCircleRing;
    }

    // Generate arcs that describe the outer border of circles.
    function generateCircleArcs(outerCircleRing) {
        let arcs = [];

        for (let i = 0; i < outerCircleRing.length; i++) {
            let circle = outerCircleRing[i].circle;
            let firstIntersection = outerCircleRing[i].intersectionPoint;
            let secondIntersection = outerCircleRing[(i + 1) % outerCircleRing.length].intersectionPoint;

            let centerToFirstIntersection = firstIntersection.sub(circle.center);
            let centerToSecondIntersection = secondIntersection.sub(circle.center);
            let arcStartAngle = new Vec2(0, -1).angle(centerToFirstIntersection);
            let arcEndAngle = new Vec2(0, -1).angle(centerToSecondIntersection);
            let artStartPoint = getCord(circle.center, arcStartAngle, circle.radius);
            let artEndPoint = getCord(circle.center, arcEndAngle, circle.radius);

            arcs.push(new Arc(circle.center.x, circle.center.y, arcStartAngle, arcEndAngle, circle.radius, artStartPoint, artEndPoint));
        }

        return arcs;
    }

    // Generate tangent arcs that fill the space between circle arcs.
    function generateTangentArcs(outerCircleRing, curvature) {
        let arcs = [];

        for (let i = 0; i < outerCircleRing.length; i++) {
            let intersection = outerCircleRing[i].intersectionPoint;
            let firstCircle = outerCircleRing[(i > 0) ? i - 1 : outerCircleRing.length - 1].circle;
            let secondCircle = outerCircleRing[i].circle;

            let intersectionToFirstCenter = firstCircle.center.sub(intersection);
            let intersectionToSecondCenter = secondCircle.center.sub(intersection);
            let arcEndAngle = new Vec2(0, -1).angle(intersectionToFirstCenter);
            let arcStartAngle = new Vec2(0, -1).angle(intersectionToSecondCenter);
            let artStartPoint = getCord(intersection, arcStartAngle, curvature);
            let artEndPoint = getCord(intersection, arcEndAngle, curvature);

            arcs.push(new Arc(intersection.x, intersection.y, arcStartAngle, arcEndAngle, curvature, artStartPoint, artEndPoint));
        }

        return arcs;
    }

    function getCord(center, angle, dist) {

        let result = new Vec2();
        dist = dist || 1;
      
        result.x = center.x + dist * Math.cos(angle-Math.PI/2);
        result.y = center.y + dist * Math.sin(angle-Math.PI/2);
      
        return result;
      };

    function arcsToPaths(arcs) {
        if(arcs.length <= 0)
            return [];

        let paths = [];
        let arcGen = d3.arc();

        /*arcs.forEach(function (arc) {
            let startAngleTemp = arc.startAngle;

            if (startAngleTemp > arc.endAngle) {
                startAngleTemp -= 2 * Math.PI;
            }

            paths.push({
                d: arcGen({
                    innerRadius: arc.radius,
                    outerRadius: arc.radius,
                    startAngle: startAngleTemp,
                    endAngle: arc.endAngle
                }),
                transform: "translate(" + arc.center.x + "," + arc.center.y + ")"
            });
        });*/

        let curPoint = arcs[0].endPoint;
        let startAngleTemp = arcs[0].startAngle;
            if (startAngleTemp > arcs[0].endAngle) {
                startAngleTemp -= 2 * Math.PI;
            }
            
        let large_arc_flag = (arcs[0].endAngle - startAngleTemp)>Math.PI ? 1 : 0;
        let sweep_flag = 0>(arcs.length/2-1) ? 0 : 1;
        let path = `M ${arcs[0].startPoint.x} ${arcs[0].startPoint.y}
                    A ${arcs[0].radius} ${arcs[0].radius}, 0 ${large_arc_flag} ${sweep_flag}, ${curPoint.x} ${curPoint.y}`
        let i = 0;
        let count = 1;
        while (count < arcs.length) {
            //console.log(getCord(arc.center, arc.startAngle, arc.radius), arc.startPoint);
            i = (i+1)%arcs.length;
            /*count++;
            arc = arcs[i];
            console.log(arc.startPoint, arc.endPoint);*/
            if (Math.abs(arcs[i].startPoint.x-curPoint.x)<1e-6 && Math.abs(arcs[i].startPoint.y-curPoint.y)<1e-6) {
            //if (true){
                curPoint = arcs[i].endPoint;
                count++;
            } else if(Math.abs(arcs[i].endPoint.x-curPoint.x)<1e-6 && Math.abs(arcs[i].endPoint.y-curPoint.y)<1e-6) {
                curPoint = arcs[i].startPoint;
                count++;
            } else {
                continue;
            }
            // rx ry, x-axis-rotation large-arc-flag sweep-flag, destinationx destinationy
            let startAngleTemp = arcs[i].startAngle;
            if (startAngleTemp > arcs[i].endAngle) {
                startAngleTemp -= 2 * Math.PI;
            }
            
            let large_arc_flag = (arcs[i].endAngle - startAngleTemp)>Math.PI ? 1 : 0;
            let sweep_flag = i>(arcs.length/2-1) ? 0 : 1;
            path += 
            `A  ${arcs[i].radius} ${arcs[i].radius}, 0 ${large_arc_flag} ${sweep_flag}, ${curPoint.x} ${curPoint.y}`
        }
        paths.push({
            d: path,
            //transform: "translate(" + arc.center.x + "," + arc.center.y + ")"
            transform: "translate(0, 0)"
        });

        return paths;
    }

    function contourHierarchy(hierarchyRoot, padding, curvature) {
        let contours = [];
        for(let layerDepth = hierarchyRoot.height; layerDepth >= hierarchyRoot.height - 4; layerDepth--) {
            // Get clusters of circles on this layer.
            let layerClusters = getLayerClusters(hierarchyRoot, layerDepth, padding);

            // Create contour for each cluster.
            layerClusters.forEach(function(cluster) {
                let generatedContour = contour(cluster.nodes, curvature);

                // Assign color to contour.
                generatedContour.forEach(function(segment) {
                    segment.strokeWidth = cluster.parent.uncertainty;
                    segment.name = cluster.parent.data.name;
                    //console.log(cluster);
                });

                contours = contours.concat(generatedContour);
            });
        }
        contours.reverse();
        return contours;
    }

    /*
     * Implanckementation.
     */
    function bubbletreemap() {
        let bubbletreemap,
            padding = 10,
            curvature = 10,
            colormap = [],
            width = 960,
            height = 1280,
            hierarchyRoot = [];

        return bubbletreemap = {
            doColoring: function() {
                // Coloring similar to paper. Adjust ./algorithm/colorhierarchy.js to change coloring.
                colorHierarchy(hierarchyRoot, colormap);
                return bubbletreemap;
            },

            doLayout: function() {
                lp(hierarchyRoot, padding, width, height);
                return bubbletreemap;
            },

            getContour: function() {
                // Compute contours.
                return contourHierarchy(hierarchyRoot, padding, curvature);
            },

            hierarchyRoot: function(_) {
                if(arguments.length) {
                    _.descendants().forEach(function(node) {
                        if(!node.r)
                            node.r = node.value; // Take value as radius if no radius is explicitly specified.

                        if(!node.uncertainty)
                            node.uncertainty = node.data.uncertainty;
                    });
                    return (hierarchyRoot = _, bubbletreemap);
                }
                else {
                    return hierarchyRoot;
                }
            },

            padding: function(_) {
                return arguments.length ? (padding = +_, bubbletreemap) : padding;
            },

            width: function(_) {
                return arguments.length ? (width = +_, bubbletreemap) : width;
            },

            height: function(_) {
                return arguments.length ? (height = +_, bubbletreemap) : height;
            },

            curvature: function(_) {
                return arguments.length ? (curvature = +_, bubbletreemap) : curvature;
            },

            colormap: function(_) {
                return arguments.length ? (colormap = _, bubbletreemap) : colormap;
            }
        };
    }

    exports.bubbletreemap = bubbletreemap;

    Object.defineProperty(exports, '__esModule', { value: true });

}));